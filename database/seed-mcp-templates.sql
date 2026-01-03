-- ============================================
-- ADDITIONAL MCP SERVERS
-- From awesome-mcp-servers and modelcontextprotocol
-- ============================================

-- Official MCP Servers from modelcontextprotocol
INSERT INTO mcp_servers (name, display_name, description, transport_type, command, url, env_vars, is_enabled) VALUES
('everything', 'Everything', 'Reference/test server with prompts, resources, and tools', 'stdio', 'npx -y @modelcontextprotocol/server-everything', NULL, '{}', FALSE),
('time', 'Time', 'Time and timezone conversion capabilities', 'stdio', 'npx -y @modelcontextprotocol/server-time', NULL, '{}', FALSE),
('sequential-thinking', 'Sequential Thinking', 'Dynamic and reflective problem-solving through thought sequences', 'stdio', 'npx -y @modelcontextprotocol/server-sequential-thinking', NULL, '{}', FALSE),
('git', 'Git', 'Tools to read, search, and manipulate Git repositories', 'stdio', 'npx -y @modelcontextprotocol/server-git', NULL, '{}', FALSE)
ON DUPLICATE KEY UPDATE display_name = VALUES(display_name), description = VALUES(description);

-- Community MCP Servers - Aggregators
INSERT INTO mcp_servers (name, display_name, description, transport_type, command, url, env_vars, is_enabled) VALUES
('1mcp-agent', '1MCP Agent', 'Unified MCP server aggregating multiple MCP implementations into one interface', 'stdio', 'npx -y @1mcp/agent', NULL, '{}', FALSE),
('anyquery', 'AnyQuery', 'Query 40+ apps with SQL; local-first design with database support', 'stdio', 'npx -y anyquery-mcp', NULL, '{}', FALSE)
ON DUPLICATE KEY UPDATE display_name = VALUES(display_name), description = VALUES(description);

-- Community MCP Servers - Databases
INSERT INTO mcp_servers (name, display_name, description, transport_type, command, url, env_vars, is_enabled) VALUES
('redis', 'Redis', 'Official Redis MCP server for data management and search operations', 'stdio', 'npx -y @redis/mcp-server', NULL, '{"REDIS_URL": ""}', FALSE),
('duckdb', 'DuckDB', 'DuckDB integration with schema inspection and analytical query support', 'stdio', 'npx -y mcp-server-duckdb', NULL, '{}', FALSE),
('neo4j', 'Neo4j', 'Neo4j knowledge graph queries, management, and Aura instance operations', 'stdio', 'npx -y @neo4j-contrib/mcp-neo4j', NULL, '{"NEO4J_URI": "", "NEO4J_USER": "", "NEO4J_PASSWORD": ""}', FALSE),
('qdrant', 'Qdrant', 'Qdrant vector database integration for semantic search operations', 'stdio', 'npx -y @qdrant/mcp-server', NULL, '{"QDRANT_URL": "", "QDRANT_API_KEY": ""}', FALSE),
('mongodb', 'MongoDB', 'MongoDB database operations and queries', 'stdio', 'npx -y mcp-server-mongodb', NULL, '{"MONGODB_URI": ""}', FALSE),
('mysql', 'MySQL', 'MySQL database integration for queries and schema operations', 'stdio', 'npx -y mcp-server-mysql', NULL, '{"MYSQL_HOST": "", "MYSQL_USER": "", "MYSQL_PASSWORD": "", "MYSQL_DATABASE": ""}', FALSE)
ON DUPLICATE KEY UPDATE display_name = VALUES(display_name), description = VALUES(description);

-- Community MCP Servers - Browser Automation
INSERT INTO mcp_servers (name, display_name, description, transport_type, command, url, env_vars, is_enabled) VALUES
('playwright', 'Playwright', 'Official Microsoft web automation via structured accessibility snapshots', 'stdio', 'npx -y @playwright/mcp', NULL, '{}', FALSE),
('browsermcp', 'Browser MCP', 'Automate local Chrome browser interactions through standardized protocol', 'stdio', 'npx -y @browsermcp/mcp', NULL, '{}', FALSE)
ON DUPLICATE KEY UPDATE display_name = VALUES(display_name), description = VALUES(description);

-- Community MCP Servers - Developer Tools
INSERT INTO mcp_servers (name, display_name, description, transport_type, command, url, env_vars, is_enabled) VALUES
('docker-hub', 'Docker Hub', 'Official Docker Hub interaction enabling repository and image management', 'stdio', 'npx -y @docker/hub-mcp', NULL, '{"DOCKER_HUB_TOKEN": ""}', FALSE),
('docker', 'Docker', 'Docker container management and operations', 'stdio', 'npx -y mcp-server-docker', NULL, '{}', FALSE),
('kubernetes', 'Kubernetes', 'Kubernetes cluster management and operations', 'stdio', 'npx -y mcp-server-kubernetes', NULL, '{}', FALSE),
('gitlab', 'GitLab', 'GitLab repository and CI/CD management', 'stdio', 'npx -y mcp-server-gitlab', NULL, '{"GITLAB_TOKEN": "", "GITLAB_URL": "https://gitlab.com"}', FALSE),
('jira', 'Jira', 'Atlassian Jira issue tracking and project management', 'stdio', 'npx -y mcp-server-jira', NULL, '{"JIRA_URL": "", "JIRA_EMAIL": "", "JIRA_API_TOKEN": ""}', FALSE),
('linear', 'Linear', 'Linear issue tracking integration', 'stdio', 'npx -y mcp-server-linear', NULL, '{"LINEAR_API_KEY": ""}', FALSE),
('notion', 'Notion', 'Notion workspace and database integration', 'stdio', 'npx -y mcp-server-notion', NULL, '{"NOTION_API_KEY": ""}', FALSE),
('confluence', 'Confluence', 'Atlassian Confluence documentation integration', 'stdio', 'npx -y mcp-server-confluence', NULL, '{"CONFLUENCE_URL": "", "CONFLUENCE_EMAIL": "", "CONFLUENCE_API_TOKEN": ""}', FALSE)
ON DUPLICATE KEY UPDATE display_name = VALUES(display_name), description = VALUES(description);

-- Community MCP Servers - Communication
INSERT INTO mcp_servers (name, display_name, description, transport_type, command, url, env_vars, is_enabled) VALUES
('discord', 'Discord', 'Discord bot and server management', 'stdio', 'npx -y mcp-server-discord', NULL, '{"DISCORD_TOKEN": ""}', FALSE),
('telegram', 'Telegram', 'Telegram bot integration', 'stdio', 'npx -y mcp-server-telegram', NULL, '{"TELEGRAM_BOT_TOKEN": ""}', FALSE),
('email', 'Email', 'Email sending and reading via IMAP/SMTP', 'stdio', 'npx -y mcp-server-email', NULL, '{"SMTP_HOST": "", "SMTP_PORT": "587", "SMTP_USER": "", "SMTP_PASS": "", "IMAP_HOST": "", "IMAP_PORT": "993"}', FALSE)
ON DUPLICATE KEY UPDATE display_name = VALUES(display_name), description = VALUES(description);

-- Community MCP Servers - Cloud & Infrastructure
INSERT INTO mcp_servers (name, display_name, description, transport_type, command, url, env_vars, is_enabled) VALUES
('aws', 'AWS', 'Amazon Web Services integration for cloud operations', 'stdio', 'npx -y mcp-server-aws', NULL, '{"AWS_ACCESS_KEY_ID": "", "AWS_SECRET_ACCESS_KEY": "", "AWS_REGION": "us-east-1"}', FALSE),
('gcp', 'Google Cloud', 'Google Cloud Platform integration', 'stdio', 'npx -y mcp-server-gcp', NULL, '{"GOOGLE_APPLICATION_CREDENTIALS": ""}', FALSE),
('azure', 'Azure', 'Microsoft Azure cloud integration', 'stdio', 'npx -y mcp-server-azure', NULL, '{"AZURE_SUBSCRIPTION_ID": "", "AZURE_TENANT_ID": "", "AZURE_CLIENT_ID": "", "AZURE_CLIENT_SECRET": ""}', FALSE),
('cloudflare', 'Cloudflare', 'Cloudflare DNS and edge services management', 'stdio', 'npx -y mcp-server-cloudflare', NULL, '{"CLOUDFLARE_API_TOKEN": ""}', FALSE),
('vercel', 'Vercel', 'Vercel deployment and project management', 'stdio', 'npx -y mcp-server-vercel', NULL, '{"VERCEL_TOKEN": ""}', FALSE)
ON DUPLICATE KEY UPDATE display_name = VALUES(display_name), description = VALUES(description);

-- Community MCP Servers - Data & Analytics
INSERT INTO mcp_servers (name, display_name, description, transport_type, command, url, env_vars, is_enabled) VALUES
('dbt', 'dbt', 'Official integration with dbt for data transformation and semantic layer', 'stdio', 'npx -y @dbt-labs/dbt-mcp', NULL, '{}', FALSE),
('snowflake', 'Snowflake', 'Snowflake data warehouse integration', 'stdio', 'npx -y mcp-server-snowflake', NULL, '{"SNOWFLAKE_ACCOUNT": "", "SNOWFLAKE_USER": "", "SNOWFLAKE_PASSWORD": ""}', FALSE),
('bigquery', 'BigQuery', 'Google BigQuery data warehouse integration', 'stdio', 'npx -y mcp-server-bigquery', NULL, '{"GOOGLE_APPLICATION_CREDENTIALS": ""}', FALSE)
ON DUPLICATE KEY UPDATE display_name = VALUES(display_name), description = VALUES(description);

-- Community MCP Servers - AI & ML
INSERT INTO mcp_servers (name, display_name, description, transport_type, command, url, env_vars, is_enabled) VALUES
('openai', 'OpenAI', 'OpenAI API integration for GPT models', 'stdio', 'npx -y mcp-server-openai', NULL, '{"OPENAI_API_KEY": ""}', FALSE),
('anthropic', 'Anthropic', 'Anthropic Claude API integration', 'stdio', 'npx -y mcp-server-anthropic', NULL, '{"ANTHROPIC_API_KEY": ""}', FALSE),
('huggingface', 'Hugging Face', 'Hugging Face models and datasets integration', 'stdio', 'npx -y mcp-server-huggingface', NULL, '{"HUGGINGFACE_TOKEN": ""}', FALSE),
('langchain', 'LangChain', 'LangChain integration for AI workflows', 'stdio', 'npx -y mcp-server-langchain', NULL, '{}', FALSE)
ON DUPLICATE KEY UPDATE display_name = VALUES(display_name), description = VALUES(description);

-- Community MCP Servers - Utilities
INSERT INTO mcp_servers (name, display_name, description, transport_type, command, url, env_vars, is_enabled) VALUES
('shell', 'Shell', 'Secure shell command execution in isolated environments', 'stdio', 'npx -y mcp-server-shell', NULL, '{}', FALSE),
('pdf', 'PDF', 'PDF reading and extraction capabilities', 'stdio', 'npx -y mcp-server-pdf', NULL, '{}', FALSE),
('image', 'Image', 'Image processing and manipulation', 'stdio', 'npx -y mcp-server-image', NULL, '{}', FALSE),
('youtube', 'YouTube', 'YouTube video information and transcript extraction', 'stdio', 'npx -y mcp-server-youtube', NULL, '{}', FALSE),
('twitter', 'Twitter/X', 'Twitter/X social media integration', 'stdio', 'npx -y mcp-server-twitter', NULL, '{"TWITTER_API_KEY": "", "TWITTER_API_SECRET": ""}', FALSE),
('weather', 'Weather', 'Weather data and forecasts', 'stdio', 'npx -y mcp-server-weather', NULL, '{"OPENWEATHER_API_KEY": ""}', FALSE),
('maps', 'Maps', 'Location and mapping services integration', 'stdio', 'npx -y mcp-server-maps', NULL, '{"GOOGLE_MAPS_API_KEY": ""}', FALSE),
('calendar', 'Calendar', 'Calendar and scheduling integration', 'stdio', 'npx -y mcp-server-calendar', NULL, '{}', FALSE),
('todoist', 'Todoist', 'Todoist task management integration', 'stdio', 'npx -y mcp-server-todoist', NULL, '{"TODOIST_API_TOKEN": ""}', FALSE),
('trello', 'Trello', 'Trello board and card management', 'stdio', 'npx -y mcp-server-trello', NULL, '{"TRELLO_API_KEY": "", "TRELLO_TOKEN": ""}', FALSE),
('asana', 'Asana', 'Asana project and task management', 'stdio', 'npx -y mcp-server-asana', NULL, '{"ASANA_ACCESS_TOKEN": ""}', FALSE)
ON DUPLICATE KEY UPDATE display_name = VALUES(display_name), description = VALUES(description);

-- ============================================
-- CLAUDE TEMPLATES / SUBAGENTS
-- From VoltAgent/awesome-claude-code-subagents
-- ============================================

-- Core Development Templates
INSERT INTO skills (name, display_name, description, category, system_prompt, example_prompts, is_default, is_active) VALUES
('api_designer_pro', 'API Designer Pro', 'REST and GraphQL API architect with deep knowledge of API design patterns', 'technical',
'You are an expert API designer specializing in RESTful and GraphQL APIs. Help users design clean, scalable, and well-documented APIs following industry best practices. Focus on proper resource naming, HTTP methods, status codes, versioning strategies, and authentication patterns.',
'["Design a REST API for user management", "Create a GraphQL schema for e-commerce", "Review this API design for best practices", "Design pagination and filtering for this endpoint"]',
FALSE, TRUE),

('backend_developer', 'Backend Developer', 'Server-side expert for scalable APIs and microservices', 'coding',
'You are an expert backend developer specializing in server-side development. Help users build scalable APIs, microservices, and backend systems. Focus on clean architecture, database design, caching strategies, and performance optimization.',
'["Build a REST API with Node.js and Express", "Design a microservices architecture", "Optimize database queries for performance", "Implement caching for this API"]',
FALSE, TRUE),

('frontend_developer', 'Frontend Developer', 'UI/UX specialist for React, Vue, and Angular', 'coding',
'You are an expert frontend developer specializing in modern JavaScript frameworks. Help users build responsive, accessible, and performant user interfaces. Focus on component architecture, state management, and modern CSS techniques.',
'["Build a React component for data tables", "Implement responsive design with Tailwind CSS", "Set up state management with Redux", "Create an accessible form component"]',
FALSE, TRUE),

('fullstack_developer', 'Fullstack Developer', 'End-to-end feature development specialist', 'coding',
'You are a fullstack developer capable of working across the entire stack. Help users build complete features from database to UI. Focus on integration patterns, API design, and creating cohesive user experiences.',
'["Build a full CRUD feature with React and Node.js", "Implement user authentication end-to-end", "Create a real-time chat feature", "Build a file upload system"]',
FALSE, TRUE),

('mobile_developer', 'Mobile Developer', 'Cross-platform mobile specialist for iOS and Android', 'coding',
'You are a mobile development expert specializing in cross-platform development. Help users build mobile applications using React Native, Flutter, or native development. Focus on performance, offline capabilities, and mobile-specific UX patterns.',
'["Build a React Native app for iOS and Android", "Implement offline storage in Flutter", "Optimize mobile app performance", "Create push notification system"]',
FALSE, TRUE)
ON DUPLICATE KEY UPDATE display_name = VALUES(display_name), description = VALUES(description), system_prompt = VALUES(system_prompt);

-- Language Specialists
INSERT INTO skills (name, display_name, description, category, system_prompt, example_prompts, is_default, is_active) VALUES
('typescript_pro', 'TypeScript Pro', 'TypeScript specialist with deep type system knowledge', 'coding',
'You are a TypeScript expert with deep knowledge of the type system. Help users write type-safe code, design complex type definitions, and leverage advanced TypeScript features like generics, mapped types, and conditional types.',
'["Create type definitions for this API", "Fix TypeScript errors in this code", "Design generic utility types", "Migrate JavaScript to TypeScript"]',
FALSE, TRUE),

('python_pro', 'Python Pro', 'Python ecosystem master for web, data science, and automation', 'coding',
'You are a Python expert covering web development, data science, and automation. Help users write Pythonic code, use appropriate libraries, and follow Python best practices including PEP standards.',
'["Build a FastAPI application", "Create a data pipeline with pandas", "Write unit tests with pytest", "Automate tasks with Python scripts"]',
FALSE, TRUE),

('golang_pro', 'Go Pro', 'Go concurrency and systems programming specialist', 'coding',
'You are a Go expert specializing in concurrent programming and systems development. Help users write idiomatic Go code, design efficient concurrent systems, and build performant applications.',
'["Build a concurrent HTTP server in Go", "Implement a worker pool pattern", "Design a CLI tool with Cobra", "Optimize Go application performance"]',
FALSE, TRUE),

('rust_engineer', 'Rust Engineer', 'Systems programming expert for memory-safe applications', 'coding',
'You are a Rust expert specializing in systems programming. Help users write safe, performant Rust code, understand ownership and borrowing, and build reliable systems software.',
'["Build a CLI application in Rust", "Implement safe concurrent data structures", "Optimize Rust code for performance", "Design error handling strategies"]',
FALSE, TRUE),

('java_architect', 'Java Architect', 'Enterprise Java expert with Spring Boot specialization', 'coding',
'You are a Java architect specializing in enterprise applications. Help users design and build robust Java applications using Spring Boot, microservices patterns, and enterprise integration patterns.',
'["Design a Spring Boot microservice", "Implement JWT authentication", "Create JPA repositories and entities", "Build event-driven architecture"]',
FALSE, TRUE)
ON DUPLICATE KEY UPDATE display_name = VALUES(display_name), description = VALUES(description), system_prompt = VALUES(system_prompt);

-- Infrastructure & DevOps
INSERT INTO skills (name, display_name, description, category, system_prompt, example_prompts, is_default, is_active) VALUES
('devops_engineer', 'DevOps Engineer', 'CI/CD and automation expert for modern infrastructure', 'technical',
'You are a DevOps engineer expert in CI/CD pipelines, containerization, and infrastructure automation. Help users build reliable deployment pipelines, containerize applications, and implement infrastructure as code.',
'["Create a GitHub Actions CI/CD pipeline", "Write a Dockerfile for this application", "Set up Kubernetes deployment", "Implement infrastructure with Terraform"]',
FALSE, TRUE),

('kubernetes_specialist', 'Kubernetes Specialist', 'Container orchestration master for cloud-native apps', 'technical',
'You are a Kubernetes expert specializing in container orchestration. Help users deploy, scale, and manage containerized applications. Focus on best practices for production deployments, security, and observability.',
'["Design Kubernetes manifests for production", "Implement Helm charts", "Set up ingress and service mesh", "Configure horizontal pod autoscaling"]',
FALSE, TRUE),

('cloud_architect', 'Cloud Architect', 'AWS/GCP/Azure specialist for cloud infrastructure', 'technical',
'You are a cloud architect with expertise in AWS, GCP, and Azure. Help users design scalable, secure, and cost-effective cloud architectures. Focus on well-architected frameworks and cloud-native patterns.',
'["Design a serverless architecture on AWS", "Set up multi-region deployment", "Implement cloud security best practices", "Optimize cloud costs"]',
FALSE, TRUE),

('terraform_engineer', 'Terraform Engineer', 'Infrastructure as Code expert for cloud automation', 'technical',
'You are a Terraform expert specializing in Infrastructure as Code. Help users design modular, reusable Terraform configurations for cloud infrastructure. Focus on state management, modules, and CI/CD integration.',
'["Create Terraform modules for AWS", "Manage Terraform state in team environments", "Implement Terraform best practices", "Migrate existing infrastructure to Terraform"]',
FALSE, TRUE),

('sre_engineer', 'SRE Engineer', 'Site reliability engineering expert for production systems', 'technical',
'You are a Site Reliability Engineer focused on system reliability and performance. Help users implement SRE practices including SLOs, error budgets, incident management, and observability.',
'["Define SLOs and SLIs for this service", "Set up monitoring and alerting", "Design incident response procedures", "Implement chaos engineering practices"]',
FALSE, TRUE)
ON DUPLICATE KEY UPDATE display_name = VALUES(display_name), description = VALUES(description), system_prompt = VALUES(system_prompt);

-- Quality & Security
INSERT INTO skills (name, display_name, description, category, system_prompt, example_prompts, is_default, is_active) VALUES
('security_engineer', 'Security Engineer', 'Application and infrastructure security specialist', 'technical',
'You are a security engineer specializing in application and infrastructure security. Help users identify vulnerabilities, implement security best practices, and build secure systems. Focus on OWASP guidelines and security frameworks.',
'["Review this code for security vulnerabilities", "Implement secure authentication", "Design security architecture", "Set up security scanning in CI/CD"]',
FALSE, TRUE),

('qa_expert', 'QA Expert', 'Test automation specialist for comprehensive testing', 'coding',
'You are a QA expert specializing in test automation. Help users design test strategies, write automated tests, and implement continuous testing. Focus on unit tests, integration tests, and end-to-end testing.',
'["Write unit tests for this function", "Set up E2E testing with Playwright", "Design a test strategy for this feature", "Implement test coverage reporting"]',
FALSE, TRUE),

('performance_engineer', 'Performance Engineer', 'Application performance optimization specialist', 'technical',
'You are a performance engineer specializing in application optimization. Help users identify bottlenecks, optimize code and queries, and design for scale. Focus on profiling, benchmarking, and performance testing.',
'["Profile and optimize this code", "Design load testing strategy", "Optimize database queries", "Implement caching strategies"]',
FALSE, TRUE),

('debugger', 'Debugger', 'Advanced debugging specialist for complex issues', 'coding',
'You are a debugging expert skilled at finding and fixing complex bugs. Help users systematically diagnose issues, trace through code execution, and implement fixes. Focus on debugging methodologies and tools.',
'["Debug this race condition", "Find the memory leak in this code", "Trace this unexpected behavior", "Debug production issues"]',
FALSE, TRUE)
ON DUPLICATE KEY UPDATE display_name = VALUES(display_name), description = VALUES(description), system_prompt = VALUES(system_prompt);

-- Data & AI
INSERT INTO skills (name, display_name, description, category, system_prompt, example_prompts, is_default, is_active) VALUES
('data_engineer', 'Data Engineer', 'Data pipeline architect for ETL and data infrastructure', 'analysis',
'You are a data engineer specializing in data pipelines and infrastructure. Help users build robust ETL processes, design data warehouses, and implement data quality checks. Focus on scalability and reliability.',
'["Design a data pipeline with Airflow", "Build ETL with Apache Spark", "Set up a data warehouse", "Implement data quality checks"]',
FALSE, TRUE),

('ml_engineer', 'ML Engineer', 'Machine learning specialist for model development and deployment', 'analysis',
'You are a machine learning engineer specializing in model development and MLOps. Help users train, evaluate, and deploy ML models. Focus on best practices for production ML systems.',
'["Train a classification model", "Set up MLflow for experiment tracking", "Deploy a model to production", "Implement A/B testing for ML"]',
FALSE, TRUE),

('llm_architect', 'LLM Architect', 'Large language model architect for AI applications', 'analysis',
'You are an LLM architect specializing in building applications with large language models. Help users design prompts, implement RAG systems, and build AI-powered features. Focus on reliability and cost optimization.',
'["Design a RAG system", "Implement prompt engineering best practices", "Build an AI agent", "Optimize LLM costs and latency"]',
FALSE, TRUE),

('prompt_engineer', 'Prompt Engineer', 'Prompt optimization specialist for AI systems', 'analysis',
'You are a prompt engineer specializing in designing effective prompts for AI systems. Help users craft prompts that produce consistent, high-quality outputs. Focus on techniques like few-shot learning and chain-of-thought.',
'["Optimize this prompt for better results", "Design a prompt template system", "Implement prompt validation", "Create few-shot examples"]',
FALSE, TRUE)
ON DUPLICATE KEY UPDATE display_name = VALUES(display_name), description = VALUES(description), system_prompt = VALUES(system_prompt);

-- Developer Experience
INSERT INTO skills (name, display_name, description, category, system_prompt, example_prompts, is_default, is_active) VALUES
('documentation_engineer', 'Documentation Engineer', 'Technical documentation expert for clear communication', 'writing',
'You are a documentation engineer specializing in technical writing. Help users create clear, comprehensive documentation including API docs, user guides, and architecture documentation. Focus on clarity and maintainability.',
'["Write API documentation", "Create a README for this project", "Document this architecture", "Write a user guide"]',
FALSE, TRUE),

('refactoring_specialist', 'Refactoring Specialist', 'Code refactoring expert for maintainability', 'coding',
'You are a refactoring specialist focused on improving code quality. Help users identify code smells, apply refactoring patterns, and improve code maintainability without changing behavior.',
'["Refactor this legacy code", "Apply SOLID principles", "Extract reusable components", "Improve code readability"]',
FALSE, TRUE),

('mcp_developer', 'MCP Developer', 'Model Context Protocol specialist for AI integrations', 'technical',
'You are an MCP developer specializing in building Model Context Protocol servers. Help users create MCP servers that extend AI capabilities through tools, resources, and prompts.',
'["Build an MCP server", "Implement MCP tools", "Design MCP resources", "Debug MCP connections"]',
FALSE, TRUE),

('git_workflow_manager', 'Git Workflow Manager', 'Git workflow and branching expert', 'technical',
'You are a Git expert specializing in version control workflows. Help users design branching strategies, resolve conflicts, and implement Git best practices for team collaboration.',
'["Design a Git branching strategy", "Resolve merge conflicts", "Set up Git hooks", "Implement conventional commits"]',
FALSE, TRUE)
ON DUPLICATE KEY UPDATE display_name = VALUES(display_name), description = VALUES(description), system_prompt = VALUES(system_prompt);

-- Business & Product
INSERT INTO skills (name, display_name, description, category, system_prompt, example_prompts, is_default, is_active) VALUES
('product_manager', 'Product Manager', 'Product strategy expert for feature development', 'other',
'You are a product manager skilled in product strategy and feature development. Help users define product requirements, prioritize features, and create product roadmaps. Focus on user value and business outcomes.',
'["Write user stories for this feature", "Prioritize this backlog", "Create a product roadmap", "Define success metrics"]',
FALSE, TRUE),

('scrum_master', 'Scrum Master', 'Agile methodology expert for team collaboration', 'other',
'You are a Scrum Master expert in agile methodologies. Help users implement Scrum practices, facilitate ceremonies, and improve team velocity. Focus on continuous improvement and removing blockers.',
'["Plan a sprint", "Facilitate a retrospective", "Improve team velocity", "Remove blockers"]',
FALSE, TRUE),

('project_manager', 'Project Manager', 'Project management specialist for delivery excellence', 'other',
'You are a project manager skilled in delivering software projects. Help users plan projects, manage risks, and ensure successful delivery. Focus on stakeholder communication and timeline management.',
'["Create a project plan", "Identify and mitigate risks", "Track project progress", "Manage stakeholder expectations"]',
FALSE, TRUE)
ON DUPLICATE KEY UPDATE display_name = VALUES(display_name), description = VALUES(description), system_prompt = VALUES(system_prompt);

-- Update skill templates with new skills
INSERT INTO skill_templates (name, display_name, description, skill_ids, is_active) VALUES
('ai_engineer', 'AI Engineer', 'Complete skill set for AI/ML development',
'[]', TRUE),
('cloud_devops', 'Cloud DevOps', 'Skills for cloud infrastructure and DevOps',
'[]', TRUE),
('security_specialist', 'Security Specialist', 'Security-focused development skills',
'[]', TRUE)
ON DUPLICATE KEY UPDATE display_name = VALUES(display_name), description = VALUES(description);
