# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

UIGen is an AI-powered React component generator with live preview. Users describe components in natural language, and the AI generates React code in a virtual file system with real-time preview capabilities.

## 📌 Quick Reference

**Important files to always check:**

- **Database Schema**: `prisma/schema.prisma` - Single source of truth for database structure, tables, fields, and relationships
- **AI System Prompt**: `src/lib/prompts/generation.tsx` - Instructions given to the AI for component generation
- **Virtual File System**: `src/lib/file-system.ts` - Core VFS implementation
- **Authentication**: `src/lib/auth.ts` - JWT session management
- **Environment Variables**: `.env` - API keys and secrets (see `.env` for ANTHROPIC_API_KEY and JWT_SECRET)

## Common Commands

### Development
```bash
npm run dev                    # Start development server with Turbopack
npm run dev:daemon            # Start dev server in background (logs to logs.txt)
npm run build                 # Build for production
npm run start                 # Start production server
npm run lint                  # Run ESLint
```

### Testing
```bash
npm test                      # Run all tests with Vitest
```

### Database
```bash
npm run setup                 # Install deps + generate Prisma client + run migrations
npm run db:reset             # Reset database (force reset migrations)
npx prisma migrate dev       # Create and apply new migration
npx prisma generate          # Regenerate Prisma client
npx prisma studio            # Open Prisma Studio (database GUI)
```

**Learn more about Prisma**: https://www.prisma.io/docs/getting-started

## Architecture

### Virtual File System (VFS)

<!-- What is a Virtual File System?
A VFS is an in-memory representation of files and folders that mimics a real filesystem
but exists only in JavaScript memory (RAM). No actual files are written to your hard drive.
This is similar to how a video game might store save data in memory before persisting it.
Learn more: https://en.wikipedia.org/wiki/Virtual_file_system -->

The core of UIGen is a client-side virtual file system (`src/lib/file-system.ts`) that exists entirely in memory—no files are written to disk. The `VirtualFileSystem` class manages a tree structure of files and directories:

- Files are stored in a `Map<string, FileNode>` for **O(1) lookups** (constant-time access, very fast!)
  - Learn about Big O notation: https://www.bigocheatsheet.com/
  - JavaScript Map: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Map
- Each node has a type (`file` | `directory`), path, name, and optional content/children
- Paths are normalized (start with `/`, no trailing slashes except root)
  - Path normalization ensures `/components/Button` and `components/Button/` are treated the same
- Parent directories are auto-created when creating files (like `mkdir -p` in Unix)
- Supports typical filesystem operations: create, read, update, delete, rename (CRUD operations)

**The VFS is serialized to JSON** (converted to a string representation) and stored in the database (`Project.data` field) for authenticated users.
- Learn about serialization: https://developer.mozilla.org/en-US/docs/Glossary/Serialization

### AI Integration Flow

<!-- This section explains how the AI actually modifies code in the virtual filesystem.
The AI doesn't directly write files - instead it uses "tools" (function calling) to interact
with the filesystem through a controlled API. This is similar to how you might give someone
specific commands like "create file X" instead of giving them direct filesystem access. -->

1. **Chat API** (`src/app/api/chat/route.ts`): Receives messages and serialized file system state
   - This is a Next.js API Route: https://nextjs.org/docs/app/building-your-application/routing/route-handlers

2. **VFS Reconstruction**: Deserializes the file system from `Record<string, FileNode>`
   - The filesystem is sent as JSON, then reconstructed into a working VFS instance

3. **AI Tools**: The Vercel AI SDK provides two tools to the LLM:
   - `str_replace_editor`: Create files, find/replace strings, insert lines at specific positions
   - `file_manager`: Rename/move files or delete files/directories
   - **What are AI tools?** Functions the AI can call to take actions (like API endpoints for the AI)
   - Learn about AI function calling: https://platform.openai.com/docs/guides/function-calling

4. **Streaming Response**: AI generates tool calls to modify the VFS, streamed back to client
   - Streaming means the response is sent in chunks as it's generated (not all at once)
   - This creates the "typing" effect you see in ChatGPT
   - Learn about streaming: https://developer.mozilla.org/en-US/docs/Web/API/Streams_API

5. **Persistence**: On completion, updated messages + VFS state are saved to database
   - The entire conversation and file system are saved so users can continue later

### Component Preview System

<!-- This is the most complex part of UIGen! It takes code from the virtual filesystem
and makes it executable in the browser using advanced web APIs. Think of it like a
mini code playground (like CodeSandbox or StackBlitz) built into the app. -->

The preview works by transforming the VFS into executable JavaScript in the browser:

#### 1. JSX Transformation (`src/lib/transform/jsx-transformer.ts`)

- Uses **Babel Standalone** to transform TypeScript/JSX to plain JavaScript
  - Babel is a compiler that converts modern JS/JSX into browser-compatible JS
  - Learn about Babel: https://babeljs.io/docs/
  - Standalone version runs in the browser (not build-time): https://babeljs.io/docs/babel-standalone
- Handles both `.tsx` and `.jsx` files
- Removes CSS imports but collects their content separately
  - CSS is handled differently than JS in the preview (injected as `<style>` tags)

#### 2. Import Map Creation (`createImportMap()`)

<!-- Import maps are a browser feature that lets you control module resolution.
Instead of having to specify full URLs for every import, you can create a "map"
that tells the browser where to find each module. -->

- Transforms all files and creates **blob URLs** for each
  - **What's a blob URL?** A special URL (like `blob:http://...`) that points to data in memory
  - This lets us create "files" that only exist in the browser's memory
  - Learn about Blob URLs: https://developer.mozilla.org/en-US/docs/Web/API/URL/createObjectURL

- Builds an **ES Module import map** mapping file paths to blob URLs
  - Import maps: https://developer.mozilla.org/en-US/docs/Web/HTML/Element/script/type/importmap
  - This allows code like `import Button from '@/components/Button'` to work in the browser

- Resolves the `@/` import alias to root directory
  - **Import aliases** are shortcuts: `@/components/X` instead of `../../components/X`
  - Common in TypeScript projects to avoid "../../.." hell

- Third-party packages load from `https://esm.sh/`
  - **esm.sh** is a CDN that serves npm packages as ES modules
  - Example: `import React from 'react'` loads from `https://esm.sh/react@19`
  - Learn about esm.sh: https://esm.sh/

- Missing local imports get placeholder components to prevent errors
  - If you import a file that doesn't exist, we create a dummy component
  - This prevents the entire preview from breaking

- Collects all CSS into a single styles string

#### 3. Preview HTML (`createPreviewHTML()`)

Generates a complete HTML document with:

- **Tailwind CSS via CDN** (`https://cdn.tailwindcss.com`)
  - CDN = Content Delivery Network (serves files over the internet)
  - The Tailwind Play CDN lets us use Tailwind without a build step
  - Learn about CDNs: https://www.cloudflare.com/learning/cdn/what-is-a-cdn/

- **Import map** as `<script type="importmap">`
  - This script tag tells the browser how to resolve imports

- Inline styles from collected CSS

- **Error boundary component** wrapping the app
  - Error boundaries catch JavaScript errors in components and show fallback UI
  - Learn about error boundaries: https://react.dev/reference/react/Component#catching-rendering-errors-with-an-error-boundary

- Syntax error display if any files failed to transform
  - Shows Babel compilation errors in a friendly format

- Entry point is `/App.jsx` (or `/App.tsx`, `/index.jsx`, etc.)
  - The "entry point" is where your app starts (like `main()` in other languages)

#### 4. Iframe Rendering (`src/components/preview/PreviewFrame.tsx`)

- Renders preview HTML in **sandboxed iframe** using `srcdoc`
  - **iframe**: An embedded webpage within a webpage
  - **sandbox**: Security feature that restricts what the iframe can do
  - **srcdoc**: Lets you provide HTML directly instead of a URL
  - Learn about iframe sandbox: https://developer.mozilla.org/en-US/docs/Web/HTML/Element/iframe#sandbox

- Sandbox allows `allow-scripts`, `allow-same-origin`, `allow-forms`
  - These permissions let the preview run JavaScript and access its own data
  - **Security note**: We need `allow-same-origin` for blob URLs to work

- Re-renders whenever `refreshTrigger` changes (file system updates)
  - **refreshTrigger** is a counter that increments when files change
  - This triggers React's useEffect to rebuild the preview

### Context Architecture

<!-- React Context is like "global state" for your component tree. Instead of passing
props down through every level, you can "provide" data at the top and "consume" it
anywhere below. Think of it like putting something in the air that all components can breathe in. -->

Two React contexts manage global state:
- Learn about React Context: https://react.dev/learn/passing-data-deeply-with-context

#### 1. FileSystemContext (`src/lib/contexts/file-system-context.tsx`)

- Wraps the VFS instance in React state
- Provides **CRUD operations** that trigger UI refreshes via `refreshTrigger`
  - **CRUD** = Create, Read, Update, Delete (the four basic operations)
- Handles tool calls from AI by applying VFS operations
- Auto-selects `/App.jsx` or first file when none selected
- Manages selected file state for code editor

#### 2. ChatContext (`src/lib/contexts/chat-context.tsx`)

- Manages chat messages and AI streaming
- Calls `/api/chat` with messages + serialized file system
- Processes tool calls in real-time and applies to FileSystemContext
- Handles Vercel AI SDK streaming responses
  - Vercel AI SDK docs: https://sdk.vercel.ai/docs

### Authentication & Database

- **JWT-based authentication** using `jose` library (`src/lib/auth.ts`)
  - **JWT** = JSON Web Token, a way to securely transmit user identity
  - Unlike session cookies, JWTs contain encoded user data (signed to prevent tampering)
  - Learn about JWT: https://jwt.io/introduction
  - jose library: https://github.com/panva/jose

- Session stored in **HTTP-only cookie** (`auth-token`)
  - **HTTP-only** means JavaScript can't access it (prevents XSS attacks)
  - Learn about HTTP-only cookies: https://owasp.org/www-community/HttpOnly

- Anonymous users can work without signing up—projects not persisted
  - "Not persisted" = not saved to database, lost on page refresh

- **Database schema** (`prisma/schema.prisma`):
  - **⚠️ IMPORTANT**: Always refer to `prisma/schema.prisma` to understand the database structure, tables, fields, and relationships
  - This is the single source of truth for the database schema
  - **Prisma** is an ORM (Object-Relational Mapping) - it lets you work with databases using JavaScript objects
  - Learn about ORMs: https://www.prisma.io/docs/concepts/overview/what-is-prisma

- **Current Schema**:
  - `User`: email (unique), password (bcrypt hashed), timestamps
    - **bcrypt** is a password hashing algorithm (makes passwords unreadable even if database is leaked)
    - Learn about bcrypt: https://github.com/kelektiv/node.bcrypt.js#readme
  - `Project`: name, userId (optional), messages (JSON string), data (JSON string - serialized VFS), timestamps
    - Messages stores the chat history
    - Data stores the serialized virtual file system state
  - **Relationships**:
    - User has many Projects (one-to-many)
    - Project belongs to User (optional - supports anonymous projects)
    - Projects **cascade delete** when user deleted
      - **Cascade delete** = automatically delete all of a user's projects when the user is deleted

- Generated Prisma client lives in `src/generated/prisma/` (not `node_modules`)
  - The Prisma client is auto-generated from your schema via `npx prisma generate`
  - It provides type-safe database queries based on your schema
  - Re-generate after any schema changes

### AI System Prompt

<!-- The "system prompt" is instructions given to the AI at the start of every conversation.
Think of it like a job description - it tells the AI what role to play and what rules to follow. -->

The generation prompt (`src/lib/prompts/generation.tsx`) instructs the AI to:
- Create React components styled with Tailwind CSS
- Always have a root `/App.jsx` file as the entry point
- Use `@/` import alias for all local files
- Never create HTML files (the preview system handles that)
- Operate on the root route `/` of the virtual filesystem

**Why these rules?**
- `/App.jsx` as entry point: Keeps projects simple and predictable
- `@/` alias: Cleaner imports, easier to refactor
- No HTML files: The preview system generates HTML from React components
- Root route: Simplifies file paths (no need to handle complex nested structures)

### Directory Structure

```
src/
├── actions/          # Server actions (create/get projects)
│                     # Server Actions: https://nextjs.org/docs/app/building-your-application/data-fetching/server-actions-and-mutations
├── app/             # Next.js App Router pages & API routes
│   ├── api/chat/    # AI streaming endpoint
│   └── [projectId]/ # Dynamic project page
│                     # Dynamic routes: https://nextjs.org/docs/app/building-your-application/routing/dynamic-routes
├── components/      # React components
│   ├── auth/        # Sign in/up forms and dialog
│   ├── chat/        # Chat interface, message list, markdown renderer
│   ├── editor/      # File tree and Monaco code editor
│   ├── preview/     # Preview iframe component
│   └── ui/          # shadcn/ui components
│                     # shadcn/ui: https://ui.shadcn.com/
├── lib/
│   ├── contexts/    # React contexts (file system, chat)
│   ├── prompts/     # AI system prompts
│   ├── tools/       # AI tool definitions (str-replace, file-manager)
│   ├── transform/   # JSX transformer & import map builder
│   ├── file-system.ts   # Virtual file system implementation
│   ├── auth.ts          # JWT authentication
│   ├── prisma.ts        # Prisma client singleton
│   │                    # Singleton pattern: https://refactoring.guru/design-patterns/singleton
│   └── provider.ts      # AI model provider (Anthropic/mock)
└── hooks/           # React hooks (useAuth)
                     # Custom hooks: https://react.dev/learn/reusing-logic-with-custom-hooks

prisma/
├── schema.prisma    # Database schema
└── migrations/      # Migration history
                     # Database migrations: https://www.prisma.io/docs/concepts/components/prisma-migrate
```

## Important Implementation Details

### Mock Provider Fallback

If `ANTHROPIC_API_KEY` is not set in `.env`, the app uses a mock provider that returns static code instead of calling the LLM. This allows development without an API key.

**Why is this useful?**
- Saves money during development (API calls cost money)
- Works offline
- Faster feedback loop (no network latency)
- Lets you test the UI without needing API credentials

### Import Alias Resolution

<!-- Import aliases are path shortcuts defined in tsconfig.json. They make imports cleaner
and easier to refactor. Instead of '../../../components/Button', you write '@/components/Button'. -->

The `@/` alias maps to the root of the virtual file system. When the JSX transformer creates the import map:
- `@/components/Button` → `/components/Button`
- Blob URLs are created for both variants
- File extensions (`.jsx`, `.tsx`) are optional in imports

**TypeScript path mapping**: https://www.typescriptlang.org/docs/handbook/module-resolution.html#path-mapping

### File System Path Normalization

All paths are normalized to:
- Start with `/` (absolute paths only)
- No trailing slash (except root `/`)
- Multiple consecutive slashes collapsed to one

**Examples:**
- `components/Button` → `/components/Button`
- `/components/Button/` → `/components/Button`
- `//components///Button` → `/components/Button`

This ensures consistent lookups in the `Map<string, FileNode>`. Without normalization, `/components/Button` and `components/Button` would be treated as different files!

### Preview Re-render Triggers

<!-- React's useEffect hook runs side effects when dependencies change. We use a
"counter trick" where we increment a number whenever files change, which triggers
the useEffect to re-run and rebuild the preview. -->

The preview updates when:
- Files are created, updated, deleted, or renamed
- `refreshTrigger` counter increments in FileSystemContext
- useEffect in PreviewFrame detects change and regenerates preview HTML

**Learn about useEffect**: https://react.dev/reference/react/useEffect

### Test Setup

Tests use **Vitest** with **jsdom** environment:
- **Vitest**: A fast test runner (like Jest but faster)
  - Vitest docs: https://vitest.dev/
- **jsdom**: A JavaScript implementation of web standards (lets you test DOM code in Node.js)
  - jsdom: https://github.com/jsdom/jsdom
- Config: `vitest.config.mts`
- Test files: `__tests__` directories or `.test.tsx` files
- **React Testing Library** for component tests
  - Testing Library: https://testing-library.com/docs/react-testing-library/intro/

**Testing philosophy**: Test behavior, not implementation
- Guide: https://kentcdodds.com/blog/testing-implementation-details

## Tech Stack

- **Framework**: Next.js 15 (App Router)
  - Docs: https://nextjs.org/docs
  - **App Router** is the new way to build Next.js apps (vs Pages Router)

- **React**: 19
  - Docs: https://react.dev/

- **TypeScript**: 5
  - Docs: https://www.typescriptlang.org/docs/
  - TypeScript adds types to JavaScript for better error checking

- **Styling**: Tailwind CSS v4
  - Docs: https://tailwindcss.com/docs
  - Utility-first CSS framework (compose styles using class names)

- **Database**: SQLite (Prisma ORM)
  - SQLite: https://www.sqlite.org/index.html
  - Lightweight database (just a file, no server needed)

- **AI**: Anthropic Claude via Vercel AI SDK
  - Claude: https://www.anthropic.com/claude
  - Vercel AI SDK: https://sdk.vercel.ai/docs

- **UI Components**: Radix UI primitives (via shadcn/ui)
  - Radix: https://www.radix-ui.com/
  - Unstyled, accessible components you can customize

- **Code Editor**: Monaco Editor
  - Monaco: https://microsoft.github.io/monaco-editor/
  - The same editor that powers VS Code!

- **Testing**: Vitest + jsdom + React Testing Library

- **Build**: Turbopack (Next.js dev mode)
  - Turbopack: https://turbo.build/pack
  - Rust-based bundler (faster than Webpack)

## Learning Resources

New to these technologies? Here are some recommended learning paths:

**Beginner Path:**
1. JavaScript fundamentals: https://javascript.info/
2. React basics: https://react.dev/learn
3. TypeScript: https://www.typescriptlang.org/docs/handbook/typescript-in-5-minutes.html
4. Next.js: https://nextjs.org/learn

**Advanced Topics:**
- Virtual DOMs and reconciliation: https://react.dev/learn/preserving-and-resetting-state
- How JavaScript modules work: https://hacks.mozilla.org/2018/03/es-modules-a-cartoon-deep-dive/
- Understanding async/await: https://javascript.info/async-await
- Web security basics: https://owasp.org/www-project-top-ten/