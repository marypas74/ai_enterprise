# Enterprise AI Chat

Enterprise-grade AI chat platform with multi-provider support, Parlant AI agent integration, and VS Code extension.

## Features

- **Multi-Provider AI**: Support for OpenAI, Anthropic Claude, Google Gemini, and local models
- **Parlant Integration**: Controlled AI agents with guidelines-based behavior
- **VS Code Extension**: IDE integration for seamless development workflow
- **Real-time Chat**: Streaming responses with markdown rendering
- **Admin Dashboard**: User management, provider configuration, system monitoring
- **Kubernetes Ready**: Production deployment with MicroK8s

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      Frontend (React)                        │
│  - Chat UI  - Admin Panel  - Parlant Management             │
└──────────────────────────┬──────────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────────┐
│                    Backend (Fastify)                         │
│  - REST API  - Auth (JWT)  - AI Providers  - WebSocket      │
└──────────┬───────────────────────────────────┬──────────────┘
           │                                   │
┌──────────▼──────────┐              ┌─────────▼─────────┐
│     MariaDB         │              │     Parlant       │
│  - Users            │              │  - Agents         │
│  - Sessions         │              │  - Guidelines     │
│  - Audit Log        │              │  - Sessions       │
└─────────────────────┘              └───────────────────┘
```

## Quick Start

### Prerequisites

- Node.js 20+
- Docker
- MicroK8s (for Kubernetes deployment)

### Local Development

```bash
# Backend
cd backend
npm install
cp .env.example .env  # Configure your API keys
npm run dev

# Frontend
cd frontend
npm install
npm run dev
```

### Kubernetes Deployment

```bash
# Run the complete setup script
sudo bash SETUP_COMPLETO.sh

# Or deploy manually
./BUILD.sh      # Build Docker images
./DEPLOY.sh     # Deploy to MicroK8s
```

## Project Structure

```
enterprise-ai-chat/
├── backend/                 # Fastify API server
│   ├── src/
│   │   ├── modules/
│   │   │   ├── auth/       # JWT authentication
│   │   │   ├── chat/       # Chat endpoints
│   │   │   ├── admin/      # Admin dashboard API
│   │   │   ├── parlant/    # Parlant proxy routes
│   │   │   └── ai/         # AI provider abstraction
│   │   └── services/       # Business logic
│   └── Dockerfile
├── frontend/                # React + Vite + Tailwind
│   ├── src/
│   │   ├── pages/          # Route components
│   │   ├── hooks/          # Zustand stores
│   │   └── components/     # Reusable UI
│   └── Dockerfile
├── parlant/                 # Parlant AI agent service
│   └── Dockerfile
├── vscode-extension/        # VS Code integration
│   ├── src/                # Extension source
│   └── webview-ui/         # React webview
├── k8s/                     # Kubernetes manifests
│   ├── backend/
│   ├── frontend/
│   ├── mariadb/
│   ├── redis/
│   └── parlant/
├── database/                # SQL schemas
└── scripts/                 # Deployment utilities
```

## Configuration

### Environment Variables

#### Backend (.env)

```env
# Database
DATABASE_HOST=mariadb
DATABASE_PORT=3306
DATABASE_USER=enterprise_ai_chat
DATABASE_PASSWORD=your_password
DATABASE_NAME=enterprise_ai_chat

# JWT
JWT_SECRET=your_jwt_secret
JWT_EXPIRES_IN=8h

# AI Providers (configure in Admin Panel or here)
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-api03-...

# Parlant
PARLANT_URL=http://parlant:8800
```

#### Parlant

```env
ANTHROPIC_API_KEY=sk-ant-api03-...
```

## API Endpoints

### Authentication

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/auth/login` | User login |
| POST | `/api/auth/register` | User registration |
| POST | `/api/auth/refresh` | Refresh JWT token |
| POST | `/api/auth/logout` | Logout |

### Chat

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/chat/message` | Send message (streaming) |
| GET | `/api/chat/history` | Get chat history |
| DELETE | `/api/chat/session/:id` | Delete session |

### Parlant

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/parlant/health` | Health check |
| GET | `/api/parlant/agents` | List agents |
| POST | `/api/parlant/agents` | Create agent |
| GET | `/api/parlant/agents/:id/guidelines` | List guidelines |
| POST | `/api/parlant/agents/:id/guidelines` | Create guideline |
| POST | `/api/parlant/sessions` | Create session |
| POST | `/api/parlant/sessions/:id/events` | Send message |

### Admin

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/admin/users` | List users |
| GET | `/api/admin/providers` | List AI providers |
| PUT | `/api/admin/providers/:id` | Update provider config |
| GET | `/api/admin/debug/system` | System diagnostics |

## VS Code Extension

Install the extension from the `vscode-extension` directory:

```bash
cd vscode-extension
npm install
npm run compile
npm run package
code --install-extension enterprise-ai-chat-*.vsix
```

### Features

- Chat panel in sidebar
- Code context awareness
- Streaming responses
- Theme integration

## Parlant AI Agents

Parlant provides controlled AI behavior through guidelines:

```typescript
// Create an agent
const agent = await api.post('/api/parlant/agents', {
  name: 'Support Agent',
  description: 'Customer support assistant'
});

// Add a guideline
await api.post(`/api/parlant/agents/${agent.id}/guidelines`, {
  condition: 'Customer asks about pricing',
  action: 'Provide current pricing information and offer to connect with sales'
});
```

## Monitoring

Access Grafana dashboard at `http://your-server:3000` (if observability stack is enabled).

Metrics include:
- Request latency
- AI provider response times
- Active users
- Token usage

## Security

- JWT authentication with refresh tokens
- CORS configuration
- Rate limiting
- SQL injection protection (parameterized queries)
- XSS protection (React escaping)
- HTTPS with cert-manager

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Run tests
5. Submit a pull request

## License

Apache 2.0

## Support

For issues and feature requests, please use the GitHub issue tracker.
