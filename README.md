# mistri360 Backend API Server

Express + PostgreSQL + Drizzle ORM backend for mistri360 Fleet Maintenance platform.

## Features
- **Express 5 API** with TypeScript
- **Drizzle ORM** with PostgreSQL
- **Zod schema validation**
- **Authentication & RBAC** (Admin, Platform Admin, Manager, Mechanic, Driver)
- **Fleet Management**: Vehicles, Work Orders, Estimates, Checklists, DVIR, Defects, PM Schedules, Compliance, and Invoices
- **PDF Report & Work Order generation**

## Getting Started

### 1. Requirements
- Node.js >= 20
- PostgreSQL database

### 2. Setup Environment
Copy `.env.example` to `.env` and set your Postgres connection string:
```bash
cp .env.example .env
```

### 3. Install Dependencies
```bash
npm install
# or
pnpm install
```

### 4. Push Database Schema & Seed Data
```bash
npm run db:push
npm run seed
```

### 5. Run Development Server
```bash
npm run dev
```
The server will start on `http://localhost:8090`.

### 6. Build for Production
```bash
npm run build
npm start
```
