# Contributing to PR Preview

This guide covers the technical details for developers working on PR Preview.

## Development Setup

### Prerequisites
- Node.js
- AWS credentials for S3 operations
- GitHub App credentials

See `DEPLOYMENT.md` at the repo root for the full list of environment variables/secrets and for local dev setup.

### Development Commands

- **Start the application**: `npm start` or `node index.js`
- **Run tests**: `npm test` (uses Mocha with TDD interface)
- **Test specific file**: `npx mocha -u tdd test/path/to/file.js`

## Architecture Overview

### Core Components

**Entry Point (`index.js`)**
- Express server handling GitHub webhooks at `/github-hook`
- Configuration endpoint at `/config` for testing configs
- Startup queue processing for batch operations
- Main webhook handler processes PR events: opened, edited, reopened, synchronize

**Controller (`lib/controller.js`)**
- Central orchestrator managing PR processing workflow
- Maintains `currently_running` set to prevent race conditions
- Handles caching of preview URLs and error reporting
- Coordinates between models and views for rendering

**Models (`lib/models/`)**
- `pr.js`: Core PR model handling GitHub API interactions and caching
- `config.js`: Validates `.pr-preview.json` config files against schema
- `branch.js`: Manages branch/head information and URL generation
- `file.js`: Handles file operations and S3 uploads
- `spec-diff.js`: Generates HTML diffs between spec versions

**Views (`lib/views/`)**
- `body.js`: Renders PR comment body with preview links and diffs
- `error.js`: Renders error messages for failed builds
- `base.js`: Base view class with common rendering utilities

**Mixins (`lib/mixins/`)**
- `fetchable.js`: HTTP request capabilities with retry logic
- `uploadable.js`: S3 upload functionality
- `immutable-cache.js` & `mutable-cache.js`: Caching strategies

### Key Services

**Authentication (`lib/auth.js`)**
- GitHub App JWT token generation
- Installation token management

**External Services (`lib/services.js`)**
- ReSpec: `https://labs.w3.org/spec-generator/`
- Bikeshed: `https://api.csswg.org/bikeshed/`
- HTML Diff: `https://services.w3.org/htmldiff`

**Post-processors (`lib/post-processor.js`)**
- emu-algify: Algorithm markup processing
- webidl-grammar: WebIDL grammar processing

## Processing Flow

1. GitHub webhook triggers on PR events
2. Controller checks for race conditions and queues request
3. PR model fetches config file and validates schema
4. Branch model generates source URLs and processes spec
5. File model handles S3 uploads for previews
6. Spec-diff model generates HTML diff if needed
7. View renders comment body with links
8. Controller updates PR comment via GitHub API

## Environment Variables

See `DEPLOYMENT.md` at the repo root.

## Testing

Tests use Mocha with TDD interface. Key test areas:
- Model validation and API interactions
- View rendering with fixtures
- Cache behavior and S3 operations
- Post-processor functionality
- Include scanning for dependency resolution

## Configuration Schema

Schema validation happens in `lib/models/config-schema.json`. The schema defines the structure and validation rules for `.pr-preview.json` files.