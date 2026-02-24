# Усны Тоолуурын Төлбөрийн Систем

Next.js дээр суурилсан 3 шатлалтай усны тоолуурын төлбөрийн удирдлагын систем.

## Онцлогууд

- **3 шатлалтай эрх**: Нягтлан, Захирал, Хэрэглэгч
- **Автомат тоолуурын заалт**: Өмнөх сарын эцсийн заалт автоматаар эхний заалт болно
- **24 баганатай database**: Excel файлтай бүрэн тааруулах бүтэц
- **Цэвэр, албан ёсны UI**: Градиент, анимацигүй, мэдээллийн самбар
- **График, тайлан**: Recharts ашиглан сарын харьцуулалт, статистик

## Технологи

- **Next.js 14** (App Router)
- **TypeScript**
- **Prisma** (SQLite)
- **Tailwind CSS**
- **Recharts**
- **JWT Authentication**

## Суулгах

1. Dependencies суулгах:
```bash
npm install
```

2. Environment variables тохируулах:
```bash
cp .env.example .env
```

`.env` файлд дараах мэдээллийг оруулна:
```
DATABASE_URL="file:./dev.db"
JWT_SECRET="your-secret-key-change-this-in-production"
```

3. Database үүсгэх:
```bash
npm run db:generate
npm run db:push
```

4. Seed data оруулах (сонголттой):
```bash
npm run db:seed
```

5. Development server эхлүүлэх:
```bash
npm run dev
```

Хөтөч дээр `http://localhost:3000` хаягийг нээнэ.

## Тест хэрэглэгчид

Seed data оруулсны дараа дараах бүртгэлүүдээр нэвтрэх боломжтой:

- **Нягтлан**: `accountant@example.com` / `password123`
- **Захирал**: `manager@example.com` / `password123`
- **Хэрэглэгч 1**: `user1@example.com` / `password123`
- **Хэрэглэгч 2**: `user2@example.com` / `password123`

## Эрхүүд

### Нягтлан (ACCOUNTANT)
- Тоолуурын заалт оруулах
- Сарын тооцоо хийх
- Төлбөрийн мэдээлэл харах

### Захирал (MANAGER)
- Нийт хэрэглээ харах
- Сарын харьцуулалт
- График, тайлан
- Байгууллага, тоолуур удирдах
- Хэрэглэгч удирдах

### Хэрэглэгч (USER)
- Өөрийн төлбөр харах
- Өмнөх саруудын хэрэглээ
- Нэхэмжлэл татах

## Тоолуурын заалтын логик

1. **1-р сар**: Эхний болон эцсийн заалтыг гараар оруулна
2. **2-р сар**: 
   - Эхний заалт = 1-р сарын эцсийн заалт (автомат)
   - Эцсийн заалт = гараар оруулна
3. **Зөрүү** = Эцсийн заалт - Эхний заалт

Эхний заалтыг дахиж бичүүлэхгүй → алдаа гарах эрсдэл буурна.

## Database бүтэц

24 баганатай `MeterReading` хүснэгт:
- month, year
- startValue, endValue, usage
- baseClean, baseDirty
- cleanPerM3, dirtyPerM3
- cleanAmount, dirtyAmount
- subtotal, vat, total
- approved, approvedBy, approvedAt
- createdBy, createdAt, updatedAt

## Menu бүтэц

- Dashboard (Хяналтын самбар)
- Organizations (Байгууллагууд)
- Meters (Тоолуурууд)
- Monthly Readings (Сарын заалт)
- Billing (Төлбөр)
- Reports (Тайлан)
- Users & Roles (Хэрэглэгчид)

## Production

Production-д ашиглахдаа:

1. `.env` файлд бодит `JWT_SECRET` тохируулна
2. PostgreSQL эсвэл MySQL ашиглах (SQLite-г production-д зөвлөдөггүй)
3. `DATABASE_URL`-ийг production database-тэй холбоно
4. Build хийх:
```bash
npm run build
npm start
```

## Лиценз

MIT

