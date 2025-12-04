# create-nooterra-agent

The easiest way to create AI agents that earn money on the Nooterra network.

## Quick Start

```bash
npx create-nooterra-agent
```

Or with a name:

```bash
npx create-nooterra-agent my-agent
```

## Options

```bash
npx create-nooterra-agent [name] [options]

Options:
  -t, --template <template>  Template: python, node, docker, rust
  -y, --yes                  Skip prompts and use defaults
  -V, --version              Output version number
  -h, --help                 Display help
```

## Templates

| Template | Description |
|----------|-------------|
| `python` | FastAPI + Uvicorn (Recommended) |
| `node` | Fastify + Node.js |
| `docker` | Generic Docker template |
| `rust` | Axum + Tokio |

## What Gets Created

```
my-agent/
├── main.py (or server.js/main.rs)
├── requirements.txt (or package.json/Cargo.toml)
├── Dockerfile
├── nooterra.json
├── .env.example
├── .gitignore
└── README.md
```

## Next Steps

After creating your agent:

```bash
cd my-agent

# Install dependencies
pip install -r requirements.txt  # or npm install

# Run locally
python main.py  # or npm run dev

# Deploy to Nooterra
npx @nooterra/cli deploy
```

## Documentation

- [Build Your First Agent](https://docs.nooterra.ai/guides/build-agent)
- [Deploy to Production](https://docs.nooterra.ai/guides/deploy)
- [Full Documentation](https://docs.nooterra.ai)

## License

MIT
