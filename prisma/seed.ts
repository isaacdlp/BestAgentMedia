import { copyFile, mkdir, stat as fsStat } from "node:fs/promises";
import { resolve } from "node:path";
import { ArticleStatus, PrismaClient, SubmissionStatus, UserRole } from "@prisma/client";
import { hash } from "bcryptjs";
import { z } from "zod";
import { seedHereCategories } from "./here-category-seed";
import { seedPublications } from "./publication-seed";
import { seedZipCodeBoundaries } from "./zip-code-boundary-seed";
import submissionFixtures from "./seed/submissions/submissions.json";
import articleFixtures from "./seed/articles/articles.json";

const prisma = new PrismaClient();

const adminConfig = z.object({
  ADMIN_EMAIL: z.string().email(),
  ADMIN_PASSWORD: z.string().min(12),
  ADMIN_NAME: z.string().min(1).default("Isaac"),
  ADMIN_SURNAME: z.string().min(1).default("de la Pena"),
  ADMIN_PHONE: z.string().min(1).default("+1 650 918 7684"),
});

async function main() {
  const config = adminConfig.parse(process.env);
  const passwordHash = await hash(config.ADMIN_PASSWORD, 12);

  const admin = await prisma.user.upsert({
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
    select: { id: true },
  });
  await seedUserPicture(admin.id, "admin.jpg");

  console.info(`Administrator account ready for ${config.ADMIN_EMAIL.toLowerCase()}.`);
  await seedZipCodeBoundaries(prisma);
  await seedPublications(prisma);
  await seedEditors(passwordHash);
  await seedSubmissions(passwordHash);
  await seedArticles(admin.id);
  await seedHereCategories(prisma);
  await seedAgents();
}

const demoContributors = [
  { email: "contributor.one@example.test", name: "Olivia", surname: "Martinez" },
  { email: "contributor.two@example.test", name: "James", surname: "Wilson" },
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
            fileName: z.string().regex(/^[a-z0-9-]+\.(?:png|jpe?g|webp)$/i),
            originalName: z.string().min(1).max(255),
            mimeType: z.enum(["image/png", "image/jpeg", "image/webp"]),
          }),
        )
        .min(1)
        .max(3),
    }),
  )
  .parse(submissionFixtures);

const submissionSeedDirectory = resolve(process.cwd(), "prisma", "seed", "submissions");
const submissionMediaDirectory = resolve(process.cwd(), "media", "submissions");

/** Creates sample contributors and their story submissions (with images) on MetroWest Living. */
async function seedSubmissions(passwordHash: string) {
  const contributors: { id: string; name: string; surname: string; email: string }[] = [];
  for (const contributor of demoContributors) {
    contributors.push(
      await prisma.user.upsert({
        where: { email: contributor.email },
        update: { name: contributor.name, surname: contributor.surname, role: null, active: true },
        create: { ...contributor, passwordHash, role: null },
        select: { id: true, name: true, surname: true, email: true },
      }),
    );
  }

  const publication = await prisma.publication.findUnique({
    where: { name: "MetroWest Living" },
    select: { id: true, name: true, zipCodes: { orderBy: { code: "asc" }, take: 1, select: { code: true } } },
  });
  if (!publication) {
    throw new Error("MetroWest Living is missing from the seeded publications.");
  }
  const postalCode = publication.zipCodes[0]?.code ?? null;

  await mkdir(submissionMediaDirectory, { recursive: true });
  for (const story of demoSubmissions) {
    const contributor = contributors.find(({ email }) => email === story.submitterEmail);
    if (!contributor) {
      throw new Error(`No seeded contributor matches ${story.submitterEmail}.`);
    }

    const data = {
      title: story.title,
      body: story.body,
      storyType: story.storyType,
      postalCode,
      submitterName: `${contributor.name} ${contributor.surname}`.trim(),
      submitterEmail: story.submitterEmail,
      submitterPhone: story.submitterPhone,
      status: story.status,
      submittedByUserId: contributor.id,
      publicationId: publication.id,
    };
    await prisma.contentSubmission.upsert({
      where: { id: story.id },
      update: data,
      create: { id: story.id, ...data },
    });

    for (const image of story.images) {
      const destinationPath = resolve(submissionMediaDirectory, image.fileName);
      await copyFile(resolve(submissionSeedDirectory, image.fileName), destinationPath);
      const { size } = await fsStat(destinationPath);
      const imageData = { originalName: image.originalName, mimeType: image.mimeType, size, submissionId: story.id };
      await prisma.submissionImage.upsert({
        where: { fileName: image.fileName },
        update: imageData,
        create: { fileName: image.fileName, ...imageData },
      });
    }
  }

  console.info(
    `Seeded ${contributors.length} contributors and ${demoSubmissions.length} submissions for ${publication.name}.`,
  );
}

const demoArticles = z
  .array(
    z.object({
      id: z.string().min(1),
      sourceSubmissionId: z.string().min(1),
      title: z.string().min(1),
      body: z.string().min(1),
      status: z.nativeEnum(ArticleStatus),
      images: z.array(
        z.object({
          fileName: z.string().regex(/^[a-z0-9-]+.(?:png|jpe?g|webp)$/i),
          originalName: z.string().min(1).max(255),
          mimeType: z.enum(["image/png", "image/jpeg", "image/webp"]),
        }),
      ),
    }),
  )
  .parse(articleFixtures);

const articleSeedDirectory = resolve(process.cwd(), "prisma", "seed", "articles");
const articleMediaDirectory = resolve(process.cwd(), "media", "articles");

/** Creates the sample articles (with images) that were written from the seeded submissions. */
async function seedArticles(authorId: string) {
  await mkdir(articleMediaDirectory, { recursive: true });
  for (const article of demoArticles) {
    const data = {
      title: article.title,
      body: article.body,
      status: article.status,
      sourceSubmissionId: article.sourceSubmissionId,
      createdByUserId: authorId,
    };
    // Keyed by the source submission so an article already written from it is updated, not duplicated.
    const { id: articleId } = await prisma.article.upsert({
      where: { sourceSubmissionId: article.sourceSubmissionId },
      update: data,
      create: { id: article.id, ...data },
      select: { id: true },
    });

    for (const [position, image] of article.images.entries()) {
      const destinationPath = resolve(articleMediaDirectory, image.fileName);
      await copyFile(resolve(articleSeedDirectory, image.fileName), destinationPath);
      const { size } = await fsStat(destinationPath);
      const imageData = { originalName: image.originalName, mimeType: image.mimeType, size, position, articleId };
      await prisma.articleImage.upsert({
        where: { fileName: image.fileName },
        update: imageData,
        create: { fileName: image.fileName, ...imageData },
      });
    }
  }
  console.info(`Seeded ${demoArticles.length} articles.`);
}

const userSeedDirectory =resolve(process.cwd(), "prisma", "seed", "users");
const userMediaDirectory = resolve(process.cwd(), "media", "users");

/** Copies a seed picture into the media directory and links it to the user. */
async function seedUserPicture(userId: string, pictureFile: string) {
  const filename = `${userId}.jpg`;
  await mkdir(userMediaDirectory, { recursive: true });
  await copyFile(resolve(userSeedDirectory, pictureFile), resolve(userMediaDirectory, filename));
  await prisma.user.update({ where: { id: userId }, data: { picturePath: `media/users/${filename}` } });
}

const seedEditorData = [
  { name: "Maria", surname: "Lopez", email: "mlopez@sfp.vc", pictureFile: "maria-lopez.jpg" },
  { name: "James", surname: "Carter", email: "jcarter@sfp.vc", pictureFile: "james-carter.jpg" },
];

/** Creates sample Editors and splits the publications between them (alternating by ID). */
async function seedEditors(passwordHash: string) {
  const editors: { id: string }[] = [];
  for (const { pictureFile, ...data } of seedEditorData) {
    const editor = await prisma.user.upsert({
      where: { email: data.email },
      update: { name: data.name, surname: data.surname, role: UserRole.EDITOR, active: true },
      create: { ...data, passwordHash, role: UserRole.EDITOR },
      select: { id: true },
    });
    await seedUserPicture(editor.id, pictureFile);
    editors.push(editor);
  }

  const publications = await prisma.publication.findMany({ select: { id: true }, orderBy: { id: "asc" } });
  await prisma.publicationPublisher.createMany({
    data: publications.map((publication, index) => ({
      userId: editors[index % editors.length].id,
      publicationId: publication.id,
    })),
    skipDuplicates: true,
  });

  console.info(`Seeded ${editors.length} editors and assigned ${publications.length} publications.`);
}

/** Mailbox passwords for seeded sub agents come from the environment; an unset value seeds an empty password. */
function seedSecret(name: string): string {
  const value = process.env[name];
  if (!value) console.warn(`${name} is not set; the seeded mailbox password will be empty.`);
  return value ?? "";
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
      smtpPassword: seedSecret("SEED_ANDREW_EVANS_PASSWORD"),
      smtpFromEmail: "aevans@sfp.vc",
      smtpFromName: "Andrew",
      smtpRequireTls: true,
      imapHost: "imap.ionos.com",
      imapPort: 993,
      imapUser: "aevans@sfp.vc",
      imapPassword: seedSecret("SEED_ANDREW_EVANS_PASSWORD"),
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
      smtpPassword: seedSecret("SEED_ANNA_SMITH_PASSWORD"),
      smtpFromEmail: "asmith@sfp.vc",
      smtpFromName: "Anna",
      smtpRequireTls: true,
      imapHost: "imap.ionos.com",
      imapPort: 993,
      imapUser: "asmith@sfp.vc",
      imapPassword: seedSecret("SEED_ANNA_SMITH_PASSWORD"),
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
      smtpPassword: seedSecret("SEED_PETER_DANIELS_PASSWORD"),
      smtpFromEmail: "pdaniels@sfp.vc",
      smtpFromName: "Peter",
      smtpRequireTls: true,
      imapHost: "imap.ionos.com",
      imapUser: "pdaniels@sfp.vc",
      imapPassword: seedSecret("SEED_PETER_DANIELS_PASSWORD"),
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

const agentMediaDirectory = resolve(process.cwd(), "media", "agents");

/** Copies persona pictures for agents without sub-agents into the media directory and links them. */
async function seedAgentPictures(pictureFilesBySlug: Record<string, string>) {
  await mkdir(agentMediaDirectory, { recursive: true });

  for (const [slug, pictureFile] of Object.entries(pictureFilesBySlug)) {
    const agent = await prisma.agent.findUnique({ where: { slug }, select: { id: true } });
    if (!agent) continue;
    const filename = `${agent.id}.jpg`;
    await copyFile(resolve(subAgentSeedDirectory, pictureFile), resolve(agentMediaDirectory, filename));
    await prisma.agent.update({ where: { id: agent.id }, data: { picturePath: `media/agents/${filename}` } });
  }

  console.info(`Seeded ${Object.keys(pictureFilesBySlug).length} agent personas.`);
}

async function seedAgents() {
  await prisma.agent.upsert({
    where: { slug: "designer" },
    update: { personaName: "Thomas Brown" },
    create: {
      name: "Designer",
      slug: "designer",
      personaName: "Thomas Brown",
      description:
        "Composes complete issue layouts with Claude: front cover, as many inner pages as the content needs and back cover, using every article and ad assigned to the issue, on editable page templates ready for review.",
      enabled: true,
      settings: {
        layoutModel: "claude-opus-5-5",
        layoutEffort: "high",
        layoutMaxOutputTokens: 128000,
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
        "Writes personal emails with Claude: invitations for new story submitters (queued as drafts for review), onboarding emails and reminders to newly listed businesses, and information requests to submitters, which it sends and follows through until the requested details arrive.",
      enabled: true,
      settings: {
        registrationUrl: "",
        submissionInvite: {
          enabled: true,
          // Invites are written by Claude from the submission and the sender's earlier submissions.
          instructions: "",
        },
        onboarding: {
          // Business onboarding emails and reminders are written by Claude from the business details.
          instructions: "",
        },
      },
    },
  });

  await prisma.agent.upsert({
    where: { slug: "editor" },
    update: { name: "Copywriter", personaName: "Lisa Lane" },
    create: {
      name: "Copywriter",
      slug: "editor",
      personaName: "Lisa Lane",
      description:
        "Reviews content submissions and articles for editorial quality, suggesting headline improvements, structural changes, and clarity fixes, and applies a review on request by revising the submission with the feedback and any details the submitter sent.",
      enabled: true,
      settings: {
        model: "claude-sonnet-5-5",
        // Claude calls are streamed; thinking counts toward this ceiling and only generated tokens are billed
        maxOutputTokens: 64000,
      },
    },
  });

  await prisma.agent.upsert({
    where: { slug: "creative" },
    update: {
      personaName: "Peter Dager",
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
      personaName: "Peter Dager",
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
        "Business development for the publication. Sends ads and articles to their advertisers for review, sells paid promotion packages for the issue and answers replies by email, and drafts sales pitches for local businesses.",
      enabled: true,
      settings: {
        advertisingUrl: "",
        sponsoredArticle: { enabled: true },
        advertisement: { enabled: true },
      },
    },
  });

  await seedAgentPictures({
    designer: "thomas-brown.jpg",
    editor: "lisa-lane.jpg",
    creative: "peter-dager.jpg",
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
