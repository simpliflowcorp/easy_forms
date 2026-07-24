# Easy Forms

Easy Forms is a modern, full-featured form builder and management platform. It enables users to create, publish, and analyze forms with ease. The platform supports real-time features, data export, notifications, and robust user authentication.

---

## Table of Contents

- [Easy Forms](#easy-forms)
  - [Table of Contents](#table-of-contents)
  - [Features](#features)
  - [Tech Stack](#tech-stack)
  - [Project Structure](#project-structure)
  - [Getting Started](#getting-started)
    - [Prerequisites](#prerequisites)
    - [Installation](#installation)
  - [Scripts](#scripts)
  - [Environment Variables](#environment-variables)
  - [Contributing](#contributing)
  - [License](#license)
  - [Additional Notes](#additional-notes)

---

## Features

- **User Authentication:** Sign up, sign in, password reset, email verification, and account management.
- **Form Builder:** Drag-and-drop interface for creating custom forms.
- **Form Management:** Edit, publish, and organize forms.
- **Analytics:** Visualize form responses with charts and tables.
- **Data Export:** Export responses as CSV, JSON, or PDF.
- **Notifications:** In-app and email notifications for important events.
- **Real-time Updates:** Live updates for notifications and collaborative features.
- **Internationalization:** Multi-language support.
- **Customizable UI:** Modular components for easy customization.

---

## Tech Stack

- **Frontend:** Next.js (React), TypeScript, SCSS
- **Backend/API:** Next.js API routes, TypeScript
- **Database:** (Configurable, see `src/dbConfig/dbConfig.ts`)
- **Authentication:** NextAuth.js
- **State Management:** (e.g., Redux or Zustand, see `src/store/store.ts`)
- **Other:** Redis, Server-Sent Events, WebSockets

---

## Project Structure

```plaintext
src/
  app/                # Next.js app directory (pages, layouts, API routes)
    (client)/         # Client-side pages and layouts
      (mainpath)/     # Main authenticated user routes (dashboard, forms, settings)
      (publicPath)/   # Publicly accessible routes (form sharing)
      auth/           # Authentication pages (sign in, sign up, etc.)
    api/              # API routes (auth, forms, export, notifications, etc.)
  components/         # Reusable React components (UI, form fields, charts, etc.)
  dbConfig/           # Database configuration
  emailTemplates/     # HTML templates for transactional emails
  helper/             # Utility functions and helpers
  hooks/              # Custom React hooks
  language/           # Localization files
  lib/                # External libraries (e.g., Redis)
  metaData/           # Static metadata (e.g., field types, countries)
  models/             # Database models (form, user, notification, etc.)
  scss/               # SCSS stylesheets
  service/            # Business logic services (e.g., notifications)
  store/              # State management
  wrappers/           # Higher-order components and context providers
```

---

## Getting Started

### Prerequisites

- Node.js (v16+ recommended)
- npm or yarn
- (Optional) Database (see `src/dbConfig/dbConfig.ts` for configuration)

### Installation

1. **Clone the repository:**
   ```bash
   git clone <repo-url>
   cd easy_forms
   ```

2. **Install dependencies:**
   ```bash
   npm install
   # or
   yarn install
   ```

3. **Configure environment variables:**
   - Copy `.env.example` to `.env.local` and fill in the required values.

4. **Run the development server:**
   ```bash
   npm run dev
   # or
   yarn dev
   ```

5. **Open [http://localhost:3000](http://localhost:3000) in your browser.**

---

## Scripts

- `dev` – Start the development server
- `build` – Build the application for production
- `start` – Start the production server
- `lint` – Run linter

---

## Environment Variables

Create a `.env.local` file in the root directory. Common variables include:

- `DATABASE_URL` – Database connection string
- `NEXTAUTH_SECRET` – Secret for NextAuth.js
- `REDIS_URL` – Redis connection string
- `EMAIL_SERVER` – SMTP server for sending emails
- `EMAIL_FROM` – Default sender email address

(See `.env.example` for a full list.)

---

## Contributing

1. Fork the repository.
2. Create a new branch (`git checkout -b feature/your-feature`).
3. Make your changes and commit them.
4. Push to your fork and submit a pull request.

---

## License

This project is licensed under the [MIT License](LICENSE).

---

## Additional Notes

- **API Routes:** All backend logic is handled via Next.js API routes under `src/app/api/`.
- **Custom Components:** UI components are in `src/components/` and are designed for reusability.
- **Styling:** SCSS modules are used for component-level and global styles.
- **Internationalization:** Add new languages in `src/language/`.
- **Email Templates:** Customize transactional emails in `src/emailTemplates/`.

---

**For more details, refer to the inline code comments and specific module documentation. If you have questions, feel free to open an issue or discussion!**

---

Let me know if you want a more detailed breakdown of any specific module or feature!
