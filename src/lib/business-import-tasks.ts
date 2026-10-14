import { BusinessImportTaskStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { buildPublicationMapData, geometryContainsCoordinate } from "@/lib/zip-code-map";
import { triggerReachoutOnboarding } from "@/lib/reachout-tasks";

const hereSearchHost = "browse.search.hereapi.com";
const hereSearchUrl = `https://${hereSearchHost}/v1/browse`;
const herePageSize = 100;
const requestTimeoutMs = 20_000;

type HereItem = {
  id: string;
  title: string;
  position: { lat: number; lng: number };
  distance?: number;
  address?: {
    label?: string;
    houseNumber?: string;
    street?: string;
    city?: string;
    state?: string;
    stateCode?: string;
    postalCode?: string;
    countryCode?: string;
  };
  categories?: Array<{ name?: string }>;
  contacts?: Array<{
    phone?: Array<{ value?: string }>;
    email?: Array<{ value?: string }>;
    www?: Array<{ value?: string }>;
  }>;
};

export async function runBusinessImportTask(taskId: string) {
  let createdCount = 0;

  try {
    const apiKey = process.env.HERE_KEY;
    if (!apiKey || apiKey === "set-this-in-your-local-env-file") {
      throw new Error("HERE Maps API key is not configured.");
    }

    const task = await prisma.businessImportTask.findUnique({
      where: { id: taskId },
    });
    if (!task || task.status !== BusinessImportTaskStatus.RUNNING) {
      return;
    }

    const zipCode = await prisma.zipCode.findUnique({
      where: { code: task.zipCode },
      select: {
        code: true,
        boundaryGeometry: true,
      },
    });
    if (!zipCode?.boundaryGeometry) {
      throw new Error(`ZIP code ${task.zipCode} has no searchable boundary.`);
    }

    const bounds = buildPublicationMapData([zipCode]).bounds;
    const [southWest, northEast] = bounds;
    const inBox = `${southWest[1]},${southWest[0]},${northEast[1]},${northEast[0]}`;
    const seenExternalIds = new Set<string>();

    const categoryRows = await prisma.hereCategory.findMany({
      where: { name: { in: task.categories } },
      select: { name: true, hereId: true },
    });
    const hereIdByName = new Map(categoryRows.map(({ name, hereId }) => [name, hereId]));
    const unknownCategories = task.categories.filter((name) => !hereIdByName.has(name));
    if (unknownCategories.length) {
      throw new Error(`Unknown HERE categories: ${unknownCategories.join(", ")}.`);
    }

    for (const category of task.categories) {
      let nextUrl: URL | null = createHereSearchUrl({
        apiKey,
        categoryId: hereIdByName.get(category)!,
        inBox,
      });

      while (nextUrl && createdCount < task.newBusinessLimit) {
        if (!(await isTaskRunning(taskId))) {
          return;
        }
        await prisma.businessImportTask.updateMany({
          where: { id: taskId, status: BusinessImportTaskStatus.RUNNING },
          data: { message: `Searching ${category} businesses in ZIP code ${task.zipCode}…` },
        });

        const response = await fetch(nextUrl, {
          signal: AbortSignal.timeout(requestTimeoutMs),
        });
        const body = await response.json().catch(() => null);
        if (!response.ok) {
          throw new Error(getHereErrorMessage(body, response.status));
        }
        const page = parseHerePage(body);
        for (const item of page.items) {
          if (!(await isTaskRunning(taskId))) {
            return;
          }
          if (
            createdCount >= task.newBusinessLimit ||
            seenExternalIds.has(item.id) ||
            !geometryContainsCoordinate(
              zipCode.boundaryGeometry,
              item.position.lng,
              item.position.lat,
            )
          ) {
            continue;
          }
          seenExternalIds.add(item.id);

          const itemCategories = (item.categories ?? [])
            .flatMap(({ name }) => (name ? [name] : []));
          const address = item.address ?? {};
          const contact = item.contacts?.[0];
          try {
            const created = await prisma.$transaction(async (transaction) => {
              const runningTask = await transaction.businessImportTask.updateMany({
                where: { id: taskId, status: BusinessImportTaskStatus.RUNNING },
                data: { updatedAt: new Date() },
              });
              if (runningTask.count === 0) {
                return false;
              }

              const existingBusiness = await transaction.business.findUnique({
                where: { externalId: item.id },
                select: { id: true },
              });
              if (existingBusiness) {
                return false;
              }

              await transaction.business.create({
                data: {
                  name: item.title,
                  sourceProvider: "HERE",
                  externalId: item.id,
                  sourceQuery: `Business search: ${category} in ZIP code ${task.zipCode}`,
                  primaryCategory: itemCategories[0] ?? category,
                  categories: itemCategories.length ? itemCategories : [category],
                  addressLabel: address.label ?? null,
                  houseNumber: address.houseNumber ?? null,
                  street: address.street ?? null,
                  city: address.city ?? null,
                  state: address.state ?? null,
                  stateCode: address.stateCode ?? null,
                  postalCode: address.postalCode ?? null,
                  countryCode: address.countryCode ?? null,
                  latitude: item.position.lat,
                  longitude: item.position.lng,
                  distanceMeters: item.distance ?? null,
                  phone: contact?.phone?.[0]?.value ?? null,
                  email: contact?.email?.[0]?.value ?? null,
                  website: contact?.www?.[0]?.value ?? null,
                  sourceRetrievedAt: new Date(),
                  importTaskId: taskId,
                },
              });
              return true;
            });
            if (!created && !(await isTaskRunning(taskId))) {
              return;
            }
            if (created) {
              createdCount += 1;
              // Fire-and-forget onboarding for each newly imported business
              void (async () => {
                const biz = await prisma.business.findFirst({
                  where: { externalId: item.id },
                  select: { id: true },
                });
                if (biz) void triggerReachoutOnboarding(biz.id);
              })();
            }
          } catch (error) {
            if (isUniqueConstraintError(error)) {
              continue;
            }
            throw error;
          }
        }

        nextUrl = getNextHerePage(page.next, apiKey);
      }
      if (createdCount >= task.newBusinessLimit) {
        break;
      }
    }

    await prisma.businessImportTask.updateMany({
      where: { id: taskId, status: BusinessImportTaskStatus.RUNNING },
      data: {
        status: BusinessImportTaskStatus.SUCCEEDED,
        message: `Successfully imported ${createdCount} new businesses from ZIP code ${task.zipCode}.`,
        finishedAt: new Date(),
      },
    });
  } catch (error) {
    console.error(`Business import task ${taskId} failed:`, error);
    await prisma.businessImportTask.updateMany({
      where: { id: taskId, status: BusinessImportTaskStatus.RUNNING },
      data: {
        status: BusinessImportTaskStatus.FAILED,
        message: `Failed: ${getErrorMessage(error)}`,
        finishedAt: new Date(),
      },
    });
  }
}

async function isTaskRunning(taskId: string) {
  const task = await prisma.businessImportTask.findUnique({
    where: { id: taskId },
    select: { status: true },
  });
  return task?.status === BusinessImportTaskStatus.RUNNING;
}

function createHereSearchUrl({
  apiKey,
  categoryId,
  inBox,
}: {
  apiKey: string;
  categoryId: string;
  inBox: string;
}) {
  const url = new URL(hereSearchUrl);
  url.searchParams.set("apiKey", apiKey);
  url.searchParams.set("in", `bbox:${inBox}`);
  // Browse requires "at"; use the box centre (inBox is west,south,east,north).
  const [west, south, east, north] = inBox.split(",").map(Number);
  url.searchParams.set("at", `${(south + north) / 2},${(west + east) / 2}`);
  url.searchParams.set("categories", categoryId);
  url.searchParams.set("limit", String(herePageSize));
  return url;
}

function parseHerePage(value: unknown): { items: HereItem[]; next: string | null } {
  if (typeof value !== "object" || value === null || !("items" in value)) {
    throw new Error("HERE Maps returned an invalid search response.");
  }
  const itemsValue = value.items;
  if (!Array.isArray(itemsValue)) {
    throw new Error("HERE Maps returned an invalid search result list.");
  }

  const items: HereItem[] = [];
  for (const item of itemsValue) {
    if (
      typeof item !== "object" ||
      item === null ||
      !("id" in item) ||
      typeof item.id !== "string" ||
      !("title" in item) ||
      typeof item.title !== "string" ||
      !("position" in item) ||
      typeof item.position !== "object" ||
      item.position === null ||
      !("lat" in item.position) ||
      typeof item.position.lat !== "number" ||
      !("lng" in item.position) ||
      typeof item.position.lng !== "number"
    ) {
      continue;
    }
    items.push(item as HereItem);
  }

  const next = "next" in value ? value.next : null;
  return {
    items,
    next: typeof next === "string" ? next : null,
  };
}

function getNextHerePage(next: string | null, apiKey: string) {
  if (!next) {
    return null;
  }
  const url = new URL(next, hereSearchUrl);
  if (url.protocol !== "https:" || url.hostname !== hereSearchHost) {
    throw new Error("HERE Maps returned an invalid pagination URL.");
  }
  url.searchParams.set("apiKey", apiKey);
  return url;
}

function getHereErrorMessage(body: unknown, status: number) {
  if (typeof body === "object" && body !== null) {
    if ("cause" in body && typeof body.cause === "string") {
      return `HERE Maps rejected the connection (HTTP ${status}): ${body.cause}`;
    }
    if ("title" in body && typeof body.title === "string") {
      return `HERE Maps rejected the connection (HTTP ${status}): ${body.title}`;
    }
  }
  return `HERE Maps rejected the connection (HTTP ${status}).`;
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.name === "TimeoutError"
      ? "HERE Maps request timed out."
      : error.message;
  }
  return "An unexpected error occurred while importing businesses.";
}

function isUniqueConstraintError(error: unknown): error is { code: "P2002" } {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "P2002"
  );
}
