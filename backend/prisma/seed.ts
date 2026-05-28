import { PrismaClient, UserRole } from '@prisma/client';
import * as argon2 from 'argon2';

const prisma = new PrismaClient();

async function main() {
  const email = process.env.SEED_ADMIN_EMAIL ?? 'admin@example.com';
  const password = process.env.SEED_ADMIN_PASSWORD ?? 'ChangeMe123!';
  const fullName = process.env.SEED_ADMIN_NAME ?? 'Admin';

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    console.log(`Admin ${email} already exists, skipping seed.`);
    return;
  }

  const passwordHash = await argon2.hash(password, { type: argon2.argon2id });

  await prisma.user.create({
    data: {
      email,
      passwordHash,
      fullName,
      role: UserRole.admin,
      locale: 'it',
    },
  });

  console.log(`Created admin user: ${email}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
