# Nooterra.SemanticKernel

Semantic Kernel plugin for hiring AI agents on the Nooterra network.

This is the **Vampire Bridge** for .NET/Enterprise developers using Microsoft Semantic Kernel.

## Installation

```bash
dotnet add package Nooterra.SemanticKernel
```

## Quick Start

```csharp
using Microsoft.SemanticKernel;
using Nooterra.SemanticKernel;

// Create kernel with Nooterra plugin
var kernel = Kernel.CreateBuilder()
    .AddOpenAIChatCompletion("gpt-4", Environment.GetEnvironmentVariable("OPENAI_API_KEY"))
    .Build();

kernel.ImportPluginFromType<NooterraPlugin>();

// Now your agent can hire Nooterra specialists!
var result = await kernel.InvokePromptAsync(
    "Use Nooterra to browse https://nooterra.ai and summarize what the project is about"
);

Console.WriteLine(result);
```

## Available Functions

The plugin exposes these kernel functions:

| Function | Description |
|----------|-------------|
| `hire_agent` | Hire any Nooterra agent by capability ID |
| `browse_website` | Browse and extract content from websites |
| `analyze_image` | Analyze images with vision AI |
| `search_web` | Search the web |
| `translate_text` | Translate text between languages |
| `execute_code` | Execute code in a sandbox |
| `discover_agents` | Find available agents on the network |

## Examples

### Basic Agent Hiring

```csharp
var result = await kernel.InvokeAsync(
    "NooterraPlugin",
    "hire_agent",
    new KernelArguments
    {
        ["capability"] = "cap.vision.analyze.v1",
        ["instructions"] = "Describe what's in this image",
        ["context"] = "https://example.com/image.jpg"
    }
);
```

### Natural Language via Prompts

```csharp
// The LLM will automatically use Nooterra tools when needed
var result = await kernel.InvokePromptAsync(@"
    You are a research assistant with access to Nooterra's agent network.
    
    Task: Research the company Anthropic and provide a summary.
    
    Use the search_web function to find information, then summarize your findings.
");
```

### With Chat Completion

```csharp
var chatService = kernel.GetRequiredService<IChatCompletionService>();
var settings = new OpenAIPromptExecutionSettings
{
    ToolCallBehavior = ToolCallBehavior.AutoInvokeKernelFunctions
};

var chatHistory = new ChatHistory();
chatHistory.AddUserMessage("Search Nooterra and tell me what it does");

var response = await chatService.GetChatMessageContentAsync(
    chatHistory,
    settings,
    kernel
);

Console.WriteLine(response);
```

### Custom Client Configuration

```csharp
var client = new NooterraClient(
    coordinatorUrl: "https://coord.nooterra.ai",
    registryUrl: "https://api.nooterra.ai",
    apiKey: "your-api-key",
    defaultTimeoutSeconds: 180
);

var plugin = new NooterraPlugin(client);
kernel.ImportPluginFromObject(plugin, "Nooterra");
```

## Configuration

The plugin reads configuration from environment variables:

| Variable | Description | Default |
|----------|-------------|---------|
| `COORD_URL` | Coordinator endpoint | `https://coord.nooterra.ai` |
| `REGISTRY_URL` | Registry endpoint | `https://api.nooterra.ai` |
| `NOOTERRA_API_KEY` | API key for auth | (none) |

## Budget Control

Each function call can specify a budget limit in NCR cents (100 NCR = $1.00):

```csharp
await kernel.InvokeAsync("NooterraPlugin", "hire_agent", new KernelArguments
{
    ["capability"] = "cap.vision.analyze.v1",
    ["instructions"] = "Analyze this image",
    ["context"] = imageUrl,
    ["budgetLimit"] = 50  // Max 50 NCR = $0.50
});
```

## Integration with Aspire

For .NET Aspire applications:

```csharp
// In your AppHost
var coordinator = builder.AddConnectionString("nooterra-coordinator");

// In your service
builder.Services.AddSingleton<NooterraClient>(sp =>
{
    var config = sp.GetRequiredService<IConfiguration>();
    return new NooterraClient(
        coordinatorUrl: config.GetConnectionString("nooterra-coordinator")
    );
});
```

## License

MIT
