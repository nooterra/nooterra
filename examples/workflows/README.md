# Demo Workflows

This directory contains example workflow DAGs for Nooterra.

## AI Content Pipeline

A multi-step workflow that:
1. Generates a blog post idea using Mistral
2. Writes the content using Llama 3
3. Summarizes it using BART
4. Analyzes sentiment
5. Generates a cover image using SDXL

```bash
node workflows/content-pipeline.js
```

## Code Review Pipeline

1. Analyzes code with DeepSeek Coder
2. Generates documentation
3. Creates test suggestions

```bash
node workflows/code-review.js
```

## Research Assistant

1. Takes a research query
2. Generates search queries
3. Summarizes findings
4. Creates embeddings for storage

```bash
node workflows/research-assistant.js
```
