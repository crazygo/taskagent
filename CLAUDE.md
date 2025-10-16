# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

TaskAgent is a TypeScript-based terminal chat application that provides an interactive AI-powered command-line interface using React and the Ink framework. It's designed as a modern TUI (Terminal User Interface) application for conversing with AI models via OpenRouter API.

## Development Commands

### Running the Application
```bash
# Install dependencies (uses Yarn Berry with Plug'n'Play)
yarn install

# Start the application
yarn start
# or directly with tsx:
tsx ui.tsx
```

### Development Environment
- **Package Manager**: Yarn Berry v4.9.1 with Plug'n'Play (no node_modules)
- **Runtime**: Node.js with ES Modules
- **Execution**: Direct TypeScript execution via tsx (no build step)
- **Logging**: Real-time logging to `debug.log`

## Architecture Overview

### Core Technology Stack
- **UI Framework**: React 19.2.0 + Ink 6.3.1 for terminal interface
- **AI Integration**: Vercel AI SDK 5.0.68 with OpenRouter API
- **Language**: TypeScript 5.9.3 with strict configuration
- **Environment**: ES Modules with NodeNext resolution

### Application Structure
The application follows a single-file architecture with `ui.tsx` as the main entry point:

- **WelcomeScreen**: Memoized component showing app info and activity history
- **MessageComponent**: Renders messages with role-based styling and formatting
- **ActiveHistory**: Displays real-time conversation flow
- **App**: Main component managing state and AI interactions

### State Management
- **Dual Message System**: `frozenMessages` (persistent history) + `activeMessages` (current session)
- **Message Types**: user, assistant, system with distinct visual styling
- **Stream Handling**: Throttled rendering (100ms intervals) for AI responses
- **Error Handling**: Comprehensive error catching and system message display

### AI Integration Pattern
The application uses a sophisticated streaming pattern:
1. Environment variable mapping (OPENROUTER_API_KEY → OPENAI_API_KEY)
2. Configurable model selection via environment variables
3. Streamed responses with content buffering and throttled UI updates
4. Proper error handling and logging throughout the stream lifecycle

## Environment Configuration

### Required Environment Variables (.env.local)
```bash
OPENROUTER_API_KEY='your-api-key-here'
OPENROUTER_MODEL_NAME='z-ai/glm-4.6'  # or other model
OPENROUTER_BASE_URL='https://openrouter.ai/api/v1'
```

### Configuration Notes
- The application automatically maps OPENROUTER_API_KEY to OPENAI_API_KEY for compatibility
- Default model falls back to 'google/gemini-flash' if not specified
- Base URL defaults to OpenRouter's API endpoint
- All environment variables are properly excluded from git via .gitignore

## Development Workflow

### Code Structure Principles
- **Single File Architecture**: All UI logic contained in `ui.tsx`
- **Functional Components**: Uses React hooks and functional programming patterns
- **Type Safety**: Strict TypeScript configuration with comprehensive type definitions
- **Performance**: Memoization and throttled rendering for smooth terminal UI

### Logging and Debugging
- Comprehensive logging to `debug.log` with timestamps
- Application lifecycle tracking (start, submissions, API calls, errors)
- Stream progress monitoring for AI responses
- Error details captured and displayed in system messages

### Key Development Patterns
1. **Message Management**: Clear separation between persistent and active messages
2. **Stream Processing**: Buffered content with controlled rendering intervals
3. **Error Boundaries**: Try-catch blocks around all AI API interactions
4. **State Updates**: Immutable state updates with proper React patterns

## Package Management Notes

### Yarn Berry Configuration
- Uses Plug'n'Play for enhanced security and performance
- `.pnp.cjs` and `.pnp.loader.mjs` files are committed to repository
- No `node_modules` directory - dependencies resolved directly from yarn.lock
- Enhanced security by eliminating traditional node_modules vulnerabilities

### Dependencies
- **Core**: React, Ink, AI SDK, TypeScript
- **Utilities**: dotenv for environment, zod for validation
- **Development**: tsx for TypeScript execution, type definitions

## Important Technical Details

### Terminal UI Considerations
- ASCII-safe rendering with proper newline handling
- Color-coded messages based on role (white=user, gray=assistant, yellow=system)
- Box styling for system errors and welcome screen
- Responsive layout using Ink's flexbox system

### Performance Optimizations
- React.memo for expensive components
- Throttled streaming updates (100ms intervals)
- Efficient state updates with minimal re-renders
- Static components for frozen message history

### Error Handling Strategy
- API errors displayed as boxed system messages
- Comprehensive logging for debugging
- Graceful fallbacks for missing configuration
- User-friendly error messages in terminal interface
- 你好