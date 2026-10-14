import { copyFile, mkdir, stat as fsStat } from "node:fs/promises";
import { resolve } from "node:path";
import { ArticleStatus, Prisma, PrismaClient, SubmissionStatus, UserRole } from "@prisma/client";
import { hash } from "bcryptjs";
import { z } from "zod";
import { seedPublications } from "./publication-seed";
import { seedZipCodeBoundaries } from "./zip-code-boundary-seed";
import submissionFixtures from "./seed/submissions/submissions.json";

const prisma = new PrismaClient();

type BusinessSeed = readonly [
  name: string,
  externalId: string,
  categories: string,
  houseNumber: string,
  street: string,
  city: string,
  state: string,
  stateCode: string,
  postalCode: string,
  countryCode: string,
  latitude: number,
  longitude: number,
  distanceMeters: number,
  phone: string | null,
  email: string | null,
  website: string | null,
];

const sampleBusinesses = [
  ["Waterways at Delray", "here:pds:place:8403fv6k-5ad0331025c20a19320c0d4ec600c496", "Organizations and Societies|Social Services", "15085", "W Tranquility Lake Dr", "Delray Beach", "Florida", "FL", "33446-3437", "USA", 26.45274, -80.17348, 62, "+15616372240", "eglasshofer@waterwaysofdelray.com", null],
  ["Burgess Electric", "here:pds:place:840dhwyr-5b0d0c038d844209a7d3ecdb24dac493", "Electrical|Specialty Trade Contractors", "8238", "Sourgum St", "Delray Beach", "Florida", "FL", "33446-9526", "USA", 26.45179, -80.17563, 189, "+15614984134", null, null],
  ["Brookdale Delray Beach", "here:pds:place:840d408k-11a42c0d6d1b000150c424636a9ff055", "Nursing Home", "8020", "W Atlantic Ave", "Delray Beach", "Florida", "FL", "33446", "USA", 26.45263, -80.17219, 191, "+15614957045", null, "http://www.sonataseniorliving.com"],
  ["Sonata Delray Beach", "here:pds:place:840dhwyr-2cb475d5feb247ebb20703e62589b950", "Nursing Home", "8020", "W Atlantic Ave", "Delray Beach", "Florida", "FL", "33446", "USA", 26.45263, -80.17219, 191, "+15612648196", "acowell@sonatadelraybeach.com", "https://sonataseniorliving.com/senior-communities-in-florida/sonata-delray-beach"],
  ["The Rucco Group", "here:pds:place:8405cd82-2fee1819de03fdb735399337caf443c3", "Real Estate Services", "7959", "W Atlantic Ave", "Delray Beach", "Florida", "FL", "33446", "USA", 26.45438, -80.17098, 357, "+15615233567", null, "https://michael-masci.remax.com"],
  ["Ultimate Nails", "here:pds:place:8403fv6k-26a3b2f66745071d1e6dbfd239aa6407", "Nail Salon", "7959", "W Atlantic Ave", "Delray Beach", "Florida", "FL", "33446", "USA", 26.45438, -80.17098, 357, "+15616383600", "ultimatenails2023@gmail.com", "https://m.facebook.com/UltimateNailsDelray/#!/UltimateNailsDelray/?ref=page_internal&mt_nav=1"],
  ["Louie's Rock'n Hot Chicken", "here:pds:place:840dhwyr-a7e8dde440c0a5ebda9588ad0cc844c5", "Restaurant", "7959", "W Atlantic Ave", "Delray Beach", "Florida", "FL", "33446", "USA", 26.45438, -80.17098, 357, "+15617137230", null, "https://www.louiesrocknhotchicken.com"],
  ["Yakitori Sushi House", "here:pds:place:840dhwyr-f189074b7ee25b0792070a3da3316e6a", "Restaurant", "7959", "W Atlantic Ave", "Delray Beach", "Florida", "FL", "33446", "USA", 26.45438, -80.17098, 357, "+15615016391", "delray.yakitori@gmail.com", "http://yakitoridelray.com"],
  ["Tamera Askew, PA", "here:pds:place:840dhwyr-0ae8481c0dbe0931deb6abb632cedc18", "Real Estate Services", "7959", "W Atlantic Ave", "Delray Beach", "Florida", "FL", "33446", "USA", 26.45438, -80.17098, 357, "+15615965421", null, "http://www.TamsFloridaHomes.com"],
  ["Sue Leonard Realtor", "here:pds:place:840dhwyr-c2fa778f4b76541187a5901bdf5d8da1", "Real Estate Services", "7959", "W Atlantic Ave", "Delray Beach", "Florida", "FL", "33446", "USA", 26.45438, -80.17098, 357, "+15619267653", "sue@sueleonard.net", "https://www.sueleonard.net"],
  ["Deborah Carr", "here:pds:place:840dhwyr-7e1644c150fb5119e590fdece973f39c", "Real Estate Services", "7959", "W Atlantic Ave", "Delray Beach", "Florida", "FL", "33446", "USA", 26.45438, -80.17098, 357, "+19546477210", "deb@thedeborahcarr.com", "https://www.TheDeborahCarr.com"],
  ["Audrey Gaffney", "here:pds:place:840dhxjc-d1edae201b5971900b694eeb7f788fa2", "Real Estate Services", "7959", "W Atlantic Ave", "Delray Beach", "Florida", "FL", "33446", "USA", 26.45438, -80.17098, 357, "+12488306721", "audreygaffneyrealty@gmail.com", null],
  ["Cathy Brewer", "here:pds:place:840dhwyr-5bd2bbd0cc3bd7c31a930db3260cc90b", "Real Estate Services", "7959", "W Atlantic Ave", "Delray Beach", "Florida", "FL", "33446", "USA", 26.45438, -80.17098, 357, "+15617672008", "cathy@theruccogroup.com", "http://TheRuccoGroup.com"],
  ["RE/MAX", "here:pds:place:840dhxn0-7e0dcb7c01ce933c5b37d0d9b811d932", "Real Estate Services", "7959", "W Atlantic Ave", "Delray Beach", "Florida", "FL", "33446", "USA", 26.45438, -80.17098, 357, "+13125103516", "ben@benarce.com", "http://LidijaBizimoski.com"],
  ["Mattress Firm", "here:pds:place:8403fv6k-2c1475432da401c08f487941d8a429e7", "Furniture Store|Home Decor Store", "7959", "W Atlantic Ave", "Delray Beach", "Florida", "FL", "33446", "USA", 26.45438, -80.17098, 357, "+13016828504", "info@mattresswarehouse.com", "https://mattresswarehouse.com/store-locator/mattress-warehouse-of-delray_beach-5506-delray_beach-florida?y_source=1_MjAwODA5NTg2Ni01NjYtbG9jYXRpb24ud2Vic2l0ZQ%3D%3D"],
  ["Xo Salon", "here:pds:place:840dhwyr-f2fa8d3c6848d7f498bc2aef285bcfbc", "Hair Salon|Wellness Center & Services", "7901", "W Atlantic Ave", "Delray Beach", "Florida", "FL", "33446", "USA", 26.45431, -80.17021, 422, "+15613884124", "xosalondelray@gmail.com", null],
  ["Cloud IX Salon", "here:pds:place:840dhwyr-c7f784883c02434bbc4f826721b0ef38", "Hair & Beauty", "7901", "W Atlantic Ave", "Delray Beach", "Florida", "FL", "33446", "USA", 26.45431, -80.17021, 422, "+15613884124", null, "https://www.cloudixsalon.com"],
] satisfies readonly BusinessSeed[];

const adminConfig = z.object({
  ADMIN_EMAIL: z.string().email(),
  ADMIN_PASSWORD: z.string().min(12),
  ADMIN_NAME: z.string().min(1).default("Isaac"),
  ADMIN_SURNAME: z.string().min(1).default("de la Pena"),
  ADMIN_PHONE: z.string().min(1).default("+1 650 918 7684"),
});

const demoPublishers = [
  {
    email: "publisher.one@example.test",
    name: "Dana",
    surname: "Brooks",
  },
  {
    email: "publisher.two@example.test",
    name: "Mateo",
    surname: "Chen",
  },
] as const;

const demoContributors = [
  {
    email: "contributor.one@example.test",
    name: "Olivia",
    surname: "Martinez",
  },
  {
    email: "contributor.two@example.test",
    name: "James",
    surname: "Wilson",
  },
] as const;

const demoSubmissions = z
  .array(
    z.object({
      id: z.string().min(1),
      title: z.string().min(1),
      storyType: z.string().min(1),
      submitterEmail: z.string().email(),
      submitterPhone: z.string().nullable(),
      body: z.string().min(1),
      status: z.nativeEnum(SubmissionStatus),
      images: z
        .array(
          z.object({
            fileName: z
              .string()
              .regex(/^[a-z0-9-]+\.(?:png|jpe?g|webp)$/i),
            originalName: z.string().min(1).max(255),
            mimeType: z.enum(["image/png", "image/jpeg", "image/webp"]),
          }),
        )
        .min(1)
        .max(3),
    }),
  )
  .length(5)
  .parse(submissionFixtures);

const submissionSeedDirectory = resolve(
  process.cwd(),
  "prisma",
  "seed",
  "submissions",
);
const submissionMediaDirectory = resolve(process.cwd(), "media", "submissions");

type SeededUser = Awaited<ReturnType<typeof prisma.user.upsert>>;

async function seedDemoUsersAndSubmissions(passwordHash: string) {
  const publishers: SeededUser[] = [];
  for (const publisher of demoPublishers) {
    publishers.push(
      await prisma.user.upsert({
        where: { email: publisher.email },
        update: {
          name: publisher.name,
          surname: publisher.surname,
          passwordHash,
          role: UserRole.PUBLISHER,
          active: true,
        },
        create: {
          ...publisher,
          passwordHash,
          role: UserRole.PUBLISHER,
        },
      }),
    );
  }

  const contributors: SeededUser[] = [];
  for (const contributor of demoContributors) {
    contributors.push(
      await prisma.user.upsert({
        where: { email: contributor.email },
        update: {
          name: contributor.name,
          surname: contributor.surname,
          passwordHash,
          role: null,
          active: true,
        },
        create: {
          ...contributor,
          passwordHash,
          role: null,
        },
      }),
    );
  }

  const publications = await prisma.publication.findMany({
    orderBy: { name: "asc" },
    select: { id: true },
  });
  await prisma.publicationPublisher.deleteMany({
    where: { userId: { in: publishers.map(({ id }) => id) } },
  });
  await prisma.publicationPublisher.createMany({
    data: publications.map((publication, index) => ({
      userId: publishers[index % publishers.length].id,
      publicationId: publication.id,
    })),
  });

  const bocaLiving = await prisma.publication.findUnique({
    where: { name: "Boca Living" },
    select: { id: true },
  });
  if (!bocaLiving) {
    throw new Error("Boca Living is missing from the seeded publications.");
  }

  await mkdir(submissionMediaDirectory, { recursive: true });
  for (const story of demoSubmissions) {
    const contributor = contributors.find(
      ({ email }) => email === story.submitterEmail,
    );
    if (!contributor) {
      throw new Error(`No seeded contributor matches ${story.submitterEmail}.`);
    }

    await prisma.contentSubmission.upsert({
      where: { id: story.id },
      update: {
        title: story.title,
        body: story.body,
        storyType: story.storyType,
        postalCode: "33486",
        submitterName: `${contributor.name} ${contributor.surname}`.trim(),
        submitterEmail: story.submitterEmail,
        submitterPhone: story.submitterPhone,
        status: story.status,
        submittedByUserId: contributor.id,
        publicationId: bocaLiving.id,
      },
      create: {
        id: story.id,
        title: story.title,
        body: story.body,
        storyType: story.storyType,
        postalCode: "33486",
        submitterName: `${contributor.name} ${contributor.surname}`.trim(),
        submitterEmail: story.submitterEmail,
        submitterPhone: story.submitterPhone,
        status: story.status,
        submittedByUserId: contributor.id,
        publicationId: bocaLiving.id,
      },
    });

    for (const image of story.images) {
      const sourcePath = resolve(submissionSeedDirectory, image.fileName);
      const destinationPath = resolve(submissionMediaDirectory, image.fileName);
      const imageStats = await fsStat(sourcePath);
      await copyFile(sourcePath, destinationPath);
      await prisma.submissionImage.upsert({
        where: { fileName: image.fileName },
        update: {
          originalName: image.originalName,
          mimeType: image.mimeType,
          size: imageStats.size,
          submissionId: story.id,
        },
        create: {
          fileName: image.fileName,
          originalName: image.originalName,
          mimeType: image.mimeType,
          size: imageStats.size,
          submissionId: story.id,
        },
      });
    }
  }

  console.info(
    `Seeded ${publishers.length} publishers, ${contributors.length} contributors, and ${demoSubmissions.length} Boca Living submissions from checked-in fixtures.`,
  );
}

// UUID-format filenames for article images (must match /^[\da-f-]{36}\.(jpg|png|webp)$/i)
const demoArticles = [
  {
    id: "seed-boca-article-01",
    sourceSubmissionId: "seed-boca-story-01",
    title: "Neighbors Turn a Quiet Shoreline Into a Cleaner Place for Everyone",
    body: "When early-morning walkers along the Boca Raton shoreline began noticing plastic bottles and fishing line collecting near the dunes, a small group of neighbors decided to do something about it. Their first cleanup brought eight volunteers; by the third Saturday, families, students, and longtime residents were arriving with reusable gloves, buckets, and a shared plan for keeping the beach welcoming.\n\nThe group now meets monthly, separating recyclables from waste and recording the most common items they find so nearby visitors can learn how to prevent litter. Local residents also helped place a simple reminder board near the path and organized a rotating schedule to check the area after busy weekends. The effort is practical rather than complicated: show up, leave the shoreline better than you found it, and invite someone new next time.\n\nFor organizer Olivia Martinez, the best result is seeing children explain the project to their parents. She hopes more neighbors will join the next gathering and help protect the coastal spaces that bring the community together.",
    status: ArticleStatus.ACCEPTED,
    images: [
      {
        id: "seed-boca-art-01-img-1",
        fileName: "cafe0001-0000-4000-8001-000000000001.png",
        originalName: "Boca neighbors organize a shoreline cleanup.png",
        mimeType: "image/png",
        caption: "Volunteers gather for a monthly shoreline cleanup in Boca Raton.",
        position: 0,
        sourceFileName: "seed-boca-story-1-1.png",
      },
      {
        id: "seed-boca-art-01-img-2",
        fileName: "cafe0001-0000-4000-8001-000000000002.png",
        originalName: "Volunteers collect litter along the beach.png",
        mimeType: "image/png",
        caption: "Residents separate recyclables from litter near the dunes.",
        position: 1,
        sourceFileName: "seed-boca-story-1-2.png",
      },
    ],
  },
  {
    id: "seed-boca-article-02",
    sourceSubmissionId: "seed-boca-story-02",
    title: "A Backyard Garden Grows Fresh Food and New Friendships",
    body: "A few raised beds behind a Boca neighborhood clubhouse have become a meeting place for residents who might otherwise only wave as they pass. The garden began with a handful of families sharing spare seedlings. Today, volunteers tend herbs, tomatoes, peppers, and pollinator-friendly flowers, with simple signs explaining which plants are ready to pick and how each bed is cared for.\n\nThe weekly garden hour welcomes every level of experience. Children help water the seedlings, experienced gardeners share seasonal advice, and newcomers can take home a small bundle of produce after pitching in. Neighbors have also started a seed exchange, making it easier for residents to try varieties suited to South Florida's warm growing season.\n\nJames Wilson says the harvest matters, but the conversations matter just as much. The project has connected new residents with longtime neighbors and given families an easy way to spend time outdoors together. The volunteers are planning another planting day and invite anyone curious about gardening to stop by, ask questions, and get their hands in the soil.",
    status: ArticleStatus.ACCEPTED,
    images: [
      {
        id: "seed-boca-art-02-img-1",
        fileName: "cafe0002-0000-4000-8002-000000000001.png",
        originalName: "Neighbors share the community garden harvest.png",
        mimeType: "image/png",
        caption: "Residents tend the raised beds behind the neighborhood clubhouse.",
        position: 0,
        sourceFileName: "seed-boca-story-2-1.png",
      },
      {
        id: "seed-boca-art-02-img-2",
        fileName: "cafe0002-0000-4000-8002-000000000002.png",
        originalName: "Volunteers tend a neighborhood vegetable bed.png",
        mimeType: "image/png",
        caption: "Families try gardening together at the weekly garden hour.",
        position: 1,
        sourceFileName: "seed-boca-story-2-2.png",
      },
    ],
  },
] as const;

const articleMediaDirectory = resolve(process.cwd(), "media", "articles");

async function seedDemoArticles() {
  const bocaLiving = await prisma.publication.findUnique({
    where: { name: "Boca Living" },
    select: { id: true },
  });
  if (!bocaLiving) throw new Error("Boca Living is missing from the seeded publications.");

  await mkdir(articleMediaDirectory, { recursive: true });

  for (const article of demoArticles) {
    await prisma.article.upsert({
      where: { id: article.id },
      update: {
        title: article.title,
        body: article.body,
        status: article.status,
        sourceSubmissionId: article.sourceSubmissionId,
      },
      create: {
        id: article.id,
        title: article.title,
        body: article.body,
        status: article.status,
        sourceSubmissionId: article.sourceSubmissionId,
      },
    });

    for (const image of article.images) {
      const sourcePath = resolve(submissionSeedDirectory, image.sourceFileName);
      const destPath = resolve(articleMediaDirectory, image.fileName);
      const imageStats = await fsStat(sourcePath);
      await copyFile(sourcePath, destPath);
      await prisma.articleImage.upsert({
        where: { id: image.id },
        update: {
          articleId: article.id,
          fileName: image.fileName,
          originalName: image.originalName,
          mimeType: image.mimeType,
          caption: image.caption,
          size: imageStats.size,
          position: image.position,
        },
        create: {
          id: image.id,
          articleId: article.id,
          fileName: image.fileName,
          originalName: image.originalName,
          mimeType: image.mimeType,
          caption: image.caption,
          size: imageStats.size,
          position: image.position,
        },
      });
    }

    await prisma.articlePublication.upsert({
      where: { articleId_publicationId: { articleId: article.id, publicationId: bocaLiving.id } },
      update: {},
      create: { articleId: article.id, publicationId: bocaLiving.id },
    });
  }

  console.info(`Seeded ${demoArticles.length} demo articles for Boca Living.`);
}

async function seedBusinesses() {
  const retrievedAt = new Date();

  for (const item of sampleBusinesses) {
    const [
      name,
      externalId,
      categoryList,
      houseNumber,
      street,
      city,
      state,
      stateCode,
      postalCode,
      countryCode,
      latitude,
      longitude,
      distanceMeters,
      phone,
      email,
      website,
    ] = item;
    const categories = categoryList.split("|");
    const primaryCategory = categories[0] ?? null;
    const addressLabel = `${name}, ${[
      houseNumber,
      street,
      city,
      stateCode,
      postalCode,
      countryCode === "USA" ? "United States" : countryCode,
    ].filter(Boolean).join(", ")}`;
    const businessData = {
      name,
      sourceProvider: "HERE",
      sourceQuery: "businesses in 33446",
      primaryCategory,
      categories,
      addressLabel,
      houseNumber,
      street,
      city,
      state,
      stateCode,
      postalCode,
      countryCode,
      latitude,
      longitude,
      distanceMeters,
      phone,
      email,
      website,
      sourceRetrievedAt: retrievedAt,
    };

    const categoriesSql =
      categories.length > 0
        ? Prisma.sql`ARRAY[${Prisma.join(categories)}]::TEXT[]`
        : Prisma.sql`ARRAY[]::TEXT[]`;

    await prisma.$executeRaw(Prisma.sql`
      INSERT INTO "Business" (
        "name", "sourceProvider", "externalId", "sourceQuery",
        "primaryCategory", "categories", "addressLabel", "houseNumber", "street",
        "city", "state", "stateCode", "postalCode", "countryCode",
        "latitude", "longitude", "distanceMeters", "phone", "email", "website",
        "sourceRetrievedAt", "createdAt", "updatedAt"
      ) VALUES (
        ${businessData.name}, ${businessData.sourceProvider},
        ${externalId}, ${businessData.sourceQuery}, ${businessData.primaryCategory},
        ${categoriesSql}, ${businessData.addressLabel}, ${businessData.houseNumber},
        ${businessData.street}, ${businessData.city}, ${businessData.state},
        ${businessData.stateCode}, ${businessData.postalCode}, ${businessData.countryCode},
        ${businessData.latitude}, ${businessData.longitude}, ${businessData.distanceMeters},
        ${businessData.phone}, ${businessData.email}, ${businessData.website},
        ${businessData.sourceRetrievedAt}, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      )
      ON CONFLICT ("externalId") DO UPDATE SET
        "name" = EXCLUDED."name",
        "sourceProvider" = EXCLUDED."sourceProvider",
        "sourceQuery" = EXCLUDED."sourceQuery",
        "primaryCategory" = EXCLUDED."primaryCategory",
        "categories" = EXCLUDED."categories",
        "addressLabel" = EXCLUDED."addressLabel",
        "houseNumber" = EXCLUDED."houseNumber",
        "street" = EXCLUDED."street",
        "city" = EXCLUDED."city",
        "state" = EXCLUDED."state",
        "stateCode" = EXCLUDED."stateCode",
        "postalCode" = EXCLUDED."postalCode",
        "countryCode" = EXCLUDED."countryCode",
        "latitude" = EXCLUDED."latitude",
        "longitude" = EXCLUDED."longitude",
        "distanceMeters" = EXCLUDED."distanceMeters",
        "phone" = EXCLUDED."phone",
        "email" = EXCLUDED."email",
        "website" = EXCLUDED."website",
        "sourceRetrievedAt" = EXCLUDED."sourceRetrievedAt",
        "updatedAt" = CURRENT_TIMESTAMP
    `);
  }

  console.info(`Seeded ${sampleBusinesses.length} sample businesses.`);
}

async function main() {
  const config = adminConfig.parse(process.env);
  const passwordHash = await hash(config.ADMIN_PASSWORD, 12);

  await prisma.user.upsert({
    where: { email: config.ADMIN_EMAIL.toLowerCase() },
    update: {
      name: config.ADMIN_NAME,
      surname: config.ADMIN_SURNAME,
      phone: config.ADMIN_PHONE,
      passwordHash,
      role: UserRole.ADMIN,
      active: true,
    },
    create: {
      email: config.ADMIN_EMAIL.toLowerCase(),
      name: config.ADMIN_NAME,
      surname: config.ADMIN_SURNAME,
      phone: config.ADMIN_PHONE,
      passwordHash,
      role: UserRole.ADMIN,
    },
  });

  console.info(`Administrator account ready for ${config.ADMIN_EMAIL.toLowerCase()}.`);
  await seedZipCodeBoundaries(prisma);
  await seedPublications(prisma);
  await seedDemoUsersAndSubmissions(passwordHash);
  await seedDemoArticles();
  await seedBusinesses();
  await seedAgents();
}

const subAgentSeedDirectory = resolve(process.cwd(), "prisma", "seed", "agents");
const subAgentMediaDirectory = resolve(process.cwd(), "media", "sub-agents");

const seedSubAgentData = [
  {
    name: "Andrew Evans",
    soul: "Young, mid-20s, from Cincinnati. Played soccer in high school, when he graduated he started working with us. Positive and cheerful, wants to be helpful in any situation.",
    cellNumber: null as string | null,
    pictureFile: "andrew-evans.jpg",
    config: {
      smtpHost: "smtp.ionos.com",
      smtpPort: 587,
      smtpUser: "aevans@sfp.vc",
      smtpPassword: process.env.SEED_ANDREW_EVANS_PASSWORD ?? "",
      smtpFromEmail: "aevans@sfp.vc",
      smtpFromName: "Andrew",
      smtpRequireTls: true,
      imapHost: "imap.ionos.com",
      imapPort: 993,
      imapUser: "aevans@sfp.vc",
      imapPassword: process.env.SEED_ANDREW_EVANS_PASSWORD ?? "",
      imapSecure: true,
    },
  },
  {
    name: "Anna Smith",
    soul: "Anna Smith started her carreer as a journalist in daily newspapers, reporting from the frontline all over the world, before settling to work with us from Atlanta. She is level-headed, cool, professional and efficient. Mid 30s.",
    cellNumber: "+1 615 266 6662",
    pictureFile: "anna-smith.jpg",
    config: {
      smtpHost: "smtp.ionos.com",
      smtpPort: 587,
      smtpUser: "asmith@sfp.vc",
      smtpPassword: process.env.SEED_ANNA_SMITH_PASSWORD ?? "",
      smtpFromEmail: "asmith@sfp.vc",
      smtpFromName: "Anna",
      smtpRequireTls: true,
      imapHost: "imap.ionos.com",
      imapPort: 993,
      imapUser: "asmith@sfp.vc",
      imapPassword: process.env.SEED_ANNA_SMITH_PASSWORD ?? "",
      imapSecure: true,
    },
  },
] as const;

async function seedSubAgents(assistantAgentId: number) {
  await mkdir(subAgentMediaDirectory, { recursive: true });

  for (const data of seedSubAgentData) {
    let subAgent = await prisma.subAgent.findFirst({
      where: { agentId: assistantAgentId, name: data.name },
      select: { id: true },
    });

    if (!subAgent) {
      subAgent = await prisma.subAgent.create({
        data: {
          agentId: assistantAgentId,
          name: data.name,
          soul: data.soul,
          cellNumber: data.cellNumber,
          config: data.config,
        },
        select: { id: true },
      });
    } else {
      await prisma.subAgent.update({
        where: { id: subAgent.id },
        data: { soul: data.soul, cellNumber: data.cellNumber, config: data.config },
      });
    }

    const pictureFilename = `${subAgent.id}.jpg`;
    const picturePath = `media/sub-agents/${pictureFilename}`;
    await copyFile(
      resolve(subAgentSeedDirectory, data.pictureFile),
      resolve(subAgentMediaDirectory, pictureFilename),
    );

    await prisma.subAgent.update({
      where: { id: subAgent.id },
      data: { picturePath },
    });
  }

  console.info(`Seeded ${seedSubAgentData.length} assistant sub agents.`);
}

const marketerSubAgentData = [
  {
    name: "Sofia Rivera",
    soul: "Sofia Rivera, mid-30s, from Miami. Former magazine advertising sales rep with a background in fashion and lifestyle media. Warm, persuasive, and genuinely enthusiastic about connecting local businesses with their communities. She leads with storytelling and always finds a personal angle.",
    cellNumber: null as string | null,
    pictureFile: "sofia-rivera.jpg" as string | null,
    config: {},
  },
  {
    name: "Peter Daniels",
    soul: "Peter Daniels, mid-40s, from Chicago. Spent 15 years in B2B media sales before joining the local publications team. Calm, analytical, and methodical. He builds trust with clear value propositions and detailed follow-ups. Businesses appreciate his no-pressure style.",
    cellNumber: null as string | null,
    pictureFile: "peter-daniels.jpg" as string | null,
    config: {
      smtpHost: "smtp.ionos.com",
      smtpPort: 587,
      smtpUser: "pdaniels@sfp.vc",
      smtpPassword: process.env.SEED_PETER_DANIELS_PASSWORD ?? "",
      smtpFromEmail: "pdaniels@sfp.vc",
      smtpFromName: "Peter",
      smtpRequireTls: true,
      imapHost: "imap.ionos.com",
      imapUser: "pdaniels@sfp.vc",
      imapPassword: process.env.SEED_PETER_DANIELS_PASSWORD ?? "",
    },
  },
];

async function seedMarketerSubAgents(marketerAgentId: number) {
  await mkdir(subAgentMediaDirectory, { recursive: true });

  for (const data of marketerSubAgentData) {
    let subAgent = await prisma.subAgent.findFirst({
      where: { agentId: marketerAgentId, name: data.name },
      select: { id: true },
    });

    if (!subAgent) {
      subAgent = await prisma.subAgent.create({
        data: {
          agentId: marketerAgentId,
          name: data.name,
          soul: data.soul,
          cellNumber: data.cellNumber,
          config: data.config,
        },
        select: { id: true },
      });
    } else {
      await prisma.subAgent.update({
        where: { id: subAgent.id },
        data: { soul: data.soul, cellNumber: data.cellNumber, config: data.config },
      });
    }

    if (data.pictureFile) {
      const sourceFile = resolve(subAgentSeedDirectory, data.pictureFile);
      try {
        await fsStat(sourceFile);
        const pictureFilename = `${subAgent.id}.jpg`;
        const picturePath = `media/sub-agents/${pictureFilename}`;
        await copyFile(sourceFile, resolve(subAgentMediaDirectory, pictureFilename));
        await prisma.subAgent.update({
          where: { id: subAgent.id },
          data: { picturePath },
        });
      } catch {
        // picture file not present in seed directory yet — skip
      }
    }
  }

  console.info(`Seeded ${marketerSubAgentData.length} marketer sub agents.`);
}

async function seedAgents() {
  await prisma.agent.upsert({
    where: { slug: "designer" },
    update: {},
    create: {
      name: "Designer",
      slug: "designer",
      description:
        "Automatically generates issue layouts using AI. Analyzes the publication's cover style and distributes articles and advertisements across pages to produce a ready-to-review design.",
      enabled: true,
      settings: {
        model: "claude-opus-4-8",
        maxOutputTokens: 12000,
      },
    },
  });

  await prisma.agent.upsert({
    where: { slug: "assistant" },
    update: {},
    create: {
      name: "Assistant",
      slug: "assistant",
      description:
        "Drafts invitation emails for new story submitters and newly discovered businesses, inviting them to register and claim their submissions or listings. Drafts are queued for admin review before any email is sent.",
      enabled: true,
      settings: {
        registrationUrl: "",
        submissionInvite: {
          enabled: true,
          subject: "Thank you for your submission — join the community",
          body: "Hi {submitterName},\n\nThank you for submitting your story \"{submissionTitle}\" to {publicationName}.\n\nCreate an account to track your submission status, receive updates from the editorial team, and stay connected with your community.\n\n{registrationUrl}\n\nBest regards,\nBest Version Media",
        },
        businessInvite: {
          enabled: true,
          subject: "Claim your listing in {publicationName}",
          body: "Hello,\n\nYour business {businessName} has been featured in {publicationName}'s business directory.\n\nCreate an account to claim your listing, keep your information up to date, and connect with your local community.\n\n{registrationUrl}\n\nBest regards,\nBest Version Media",
        },
      },
    },
  });

  await prisma.agent.upsert({
    where: { slug: "editor" },
    update: { name: "Copywriter" },
    create: {
      name: "Copywriter",
      slug: "editor",
      description:
        "Reviews content submissions and articles for editorial quality. Suggests headline improvements, structural changes, and clarity fixes so the publication team can refine copy before acceptance.",
      enabled: true,
      settings: {
        model: "claude-sonnet-4-5",
        maxOutputTokens: 4000,
      },
    },
  });

  await prisma.agent.upsert({
    where: { slug: "creative" },
    update: {
      settings: {
        model: "gemini-3-pro-image",
        genericInstructions:
          "Upscale and sharpen the image to the highest possible resolution and clarity. " +
          "Correct exposure, white balance, and color grading for professional print reproduction. " +
          "Remove noise, grain, JPEG artifacts, and compression banding. " +
          "Enhance contrast and microcontrast so fine details read clearly on a printed page. " +
          "Ensure skin tones are natural and neutral backgrounds are clean. " +
          "Make the image look polished and editorial — suitable for the cover or inside spread of a community lifestyle magazine.",
      },
    },
    create: {
      name: "Creative",
      slug: "creative",
      description:
        "Enhances images using the Gemini image API to produce professional, print-ready visuals for publication. Accepts per-image enhancement instructions and stores results for editor review before applying changes.",
      enabled: true,
      settings: {
        model: "gemini-3-pro-image",
        genericInstructions:
          "Upscale and sharpen the image to the highest possible resolution and clarity. " +
          "Correct exposure, white balance, and color grading for professional print reproduction. " +
          "Remove noise, grain, JPEG artifacts, and compression banding. " +
          "Enhance contrast and microcontrast so fine details read clearly on a printed page. " +
          "Ensure skin tones are natural and neutral backgrounds are clean. " +
          "Make the image look polished and editorial — suitable for the cover or inside spread of a community lifestyle magazine.",
      },
    },
  });

  await prisma.agent.upsert({
    where: { slug: "marketer" },
    update: {},
    create: {
      name: "Marketer",
      slug: "marketer",
      description:
        "Drafts personalised sales pitches for local businesses, inviting them to purchase Sponsored Articles (paid content features) or Advertisements (banner placements) in upcoming issues. Drafts are queued for admin review before any email is sent.",
      enabled: true,
      settings: {
        advertisingUrl: "",
        sponsoredArticle: {
          enabled: true,
          subject: "Feature {businessName} in {publicationName}",
          body: "Hello,\n\nI'm reaching out from Best Version Media's sales team for {publicationName}.\n\nWe'd love to feature {businessName} as a sponsored article in our next issue — a professionally written community spotlight that puts your business in front of local homeowners and residents who are actively looking to support neighbourhood businesses.\n\nA sponsored article gives you:\n• A full editorial-style feature written by our team\n• Prominent placement in an upcoming issue\n• Distribution to local subscribers and online readers\n• A lasting digital record of your community presence\n\nWe'd be happy to walk you through the details and answer any questions. Simply reply to this email or visit our advertising page:\n\n{advertisingUrl}\n\nWarm regards,\n{agentName}\nBest Version Media",
        },
        advertisement: {
          enabled: true,
          subject: "Advertise {businessName} in {publicationName}",
          body: "Hello,\n\nI'm reaching out from Best Version Media's sales team for {publicationName}.\n\nWe have advertising placement opportunities available in our next issue — a great way to get {businessName} in front of local homeowners and residents in your area.\n\nOur banner ads are professionally designed, high-impact placements that appear alongside curated community content. Readers trust our publication and actively engage with local business features.\n\nInterested in learning more? Reply to this email or submit your ad inquiry here:\n\n{advertisingUrl}\n\nWarm regards,\n{agentName}\nBest Version Media",
        },
      },
    },
  });

  const assistantAgent = await prisma.agent.findUnique({
    where: { slug: "assistant" },
    select: { id: true },
  });
  if (!assistantAgent) throw new Error("Assistant agent not found after seeding.");

  await seedSubAgents(assistantAgent.id);

  const marketerAgent = await prisma.agent.findUnique({
    where: { slug: "marketer" },
    select: { id: true },
  });
  if (!marketerAgent) throw new Error("Marketer agent not found after seeding.");

  await seedMarketerSubAgents(marketerAgent.id);

  console.info("Agents ready.");
}

main()
  .catch((error: unknown) => {
    console.error("Database seed failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
