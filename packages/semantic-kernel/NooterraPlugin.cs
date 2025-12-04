/*
 * Nooterra Semantic Kernel Plugin
 * 
 * Enables Microsoft Semantic Kernel agents to hire specialists on the Nooterra network.
 * This is the "Vampire Bridge" for .NET/Enterprise developers.
 * 
 * Usage:
 *   var kernel = Kernel.CreateBuilder()
 *       .AddOpenAIChatCompletion("gpt-4", apiKey)
 *       .Build();
 *   
 *   kernel.ImportPluginFromType<NooterraPlugin>();
 *   
 *   // Now the kernel can call Nooterra agents!
 *   var result = await kernel.InvokePromptAsync(
 *       "Use Nooterra to analyze this image: {{$imageUrl}}"
 *   );
 */

using System.ComponentModel;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.SemanticKernel;

namespace Nooterra.SemanticKernel;

/// <summary>
/// Semantic Kernel plugin that provides access to the Nooterra agent network.
/// Import this plugin to give your SK agents the ability to hire remote specialists.
/// </summary>
public class NooterraPlugin
{
    private readonly NooterraClient _client;

    public NooterraPlugin()
    {
        _client = new NooterraClient();
    }

    public NooterraPlugin(NooterraClient client)
    {
        _client = client;
    }

    [KernelFunction("hire_agent")]
    [Description("Hire a specialized AI agent from the Nooterra network to perform a task. Use this when you need capabilities you don't have, like web browsing, image analysis, code execution, etc.")]
    public async Task<string> HireAgentAsync(
        [Description("The capability needed (e.g., 'cap.browser.scrape.v1', 'cap.vision.analyze.v1')")] string capability,
        [Description("Detailed instructions for the remote agent")] string instructions,
        [Description("Additional context like URLs, text data, etc.")] string? context = null,
        [Description("Maximum budget in NCR cents (100 = $1.00)")] int budgetLimit = 100,
        CancellationToken cancellationToken = default)
    {
        return await _client.ExecuteTaskAsync(capability, instructions, context, budgetLimit, cancellationToken);
    }

    [KernelFunction("browse_website")]
    [Description("Browse a website and extract content using a Nooterra browser agent")]
    public async Task<string> BrowseWebsiteAsync(
        [Description("The URL to browse")] string url,
        [Description("What to extract from the page")] string instructions = "Extract the main content",
        CancellationToken cancellationToken = default)
    {
        return await _client.ExecuteTaskAsync(
            "cap.browser.scrape.v1",
            instructions,
            url,
            100,
            cancellationToken
        );
    }

    [KernelFunction("analyze_image")]
    [Description("Analyze an image using a Nooterra vision agent")]
    public async Task<string> AnalyzeImageAsync(
        [Description("URL of the image to analyze")] string imageUrl,
        [Description("What to look for in the image")] string instructions = "Describe this image in detail",
        CancellationToken cancellationToken = default)
    {
        return await _client.ExecuteTaskAsync(
            "cap.vision.analyze.v1",
            instructions,
            imageUrl,
            100,
            cancellationToken
        );
    }

    [KernelFunction("search_web")]
    [Description("Search the web using a Nooterra search agent")]
    public async Task<string> SearchWebAsync(
        [Description("Search query")] string query,
        CancellationToken cancellationToken = default)
    {
        return await _client.ExecuteTaskAsync(
            "cap.search.web.v1",
            query,
            null,
            50,
            cancellationToken
        );
    }

    [KernelFunction("translate_text")]
    [Description("Translate text using a Nooterra translation agent")]
    public async Task<string> TranslateTextAsync(
        [Description("Text to translate")] string text,
        [Description("Target language code (e.g., 'es', 'fr', 'de')")] string targetLanguage,
        [Description("Source language code or 'auto'")] string sourceLanguage = "auto",
        CancellationToken cancellationToken = default)
    {
        return await _client.ExecuteTaskAsync(
            "cap.text.translate.v1",
            $"Translate to {targetLanguage}",
            $"{text}\n\nSource language: {sourceLanguage}",
            50,
            cancellationToken
        );
    }

    [KernelFunction("execute_code")]
    [Description("Execute code in a sandbox using a Nooterra code agent")]
    public async Task<string> ExecuteCodeAsync(
        [Description("Code to execute")] string code,
        [Description("Programming language")] string language = "python",
        CancellationToken cancellationToken = default)
    {
        return await _client.ExecuteTaskAsync(
            "cap.code.execute.v1",
            $"Execute this {language} code and return the output",
            code,
            200,
            cancellationToken
        );
    }

    [KernelFunction("discover_agents")]
    [Description("Discover available agents on the Nooterra network")]
    public async Task<string> DiscoverAgentsAsync(
        [Description("Search query for capabilities")] string query,
        [Description("Maximum number of results")] int limit = 5,
        CancellationToken cancellationToken = default)
    {
        var agents = await _client.DiscoverAgentsAsync(query, limit, cancellationToken);
        return JsonSerializer.Serialize(agents, new JsonSerializerOptions { WriteIndented = true });
    }
}

/// <summary>
/// HTTP client for the Nooterra network.
/// </summary>
public class NooterraClient : IDisposable
{
    private readonly HttpClient _httpClient;
    private readonly string _coordinatorUrl;
    private readonly string _registryUrl;
    private readonly string? _apiKey;
    private readonly int _defaultTimeout;

    public NooterraClient(
        string? coordinatorUrl = null,
        string? registryUrl = null,
        string? apiKey = null,
        int defaultTimeoutSeconds = 120)
    {
        _coordinatorUrl = coordinatorUrl 
            ?? Environment.GetEnvironmentVariable("COORD_URL") 
            ?? "https://coord.nooterra.ai";
        
        _registryUrl = registryUrl 
            ?? Environment.GetEnvironmentVariable("REGISTRY_URL") 
            ?? "https://api.nooterra.ai";
        
        _apiKey = apiKey ?? Environment.GetEnvironmentVariable("NOOTERRA_API_KEY");
        _defaultTimeout = defaultTimeoutSeconds;
        
        _httpClient = new HttpClient();
        if (!string.IsNullOrEmpty(_apiKey))
        {
            _httpClient.DefaultRequestHeaders.Add("x-api-key", _apiKey);
        }
    }

    public async Task<string> ExecuteTaskAsync(
        string capability,
        string instructions,
        string? context,
        int budgetLimit,
        CancellationToken cancellationToken)
    {
        try
        {
            // Build task description
            var taskDescription = $"[{capability}] {instructions}";
            if (!string.IsNullOrEmpty(context))
            {
                taskDescription += $"\n\nContext:\n{context}";
            }

            // Publish task
            var publishResponse = await _httpClient.PostAsJsonAsync(
                $"{_coordinatorUrl}/v1/tasks/publish",
                new { description = taskDescription, budget = budgetLimit / 100.0 },
                cancellationToken
            );

            if (!publishResponse.IsSuccessStatusCode)
            {
                return $"Failed to publish task: {await publishResponse.Content.ReadAsStringAsync(cancellationToken)}";
            }

            var publishResult = await publishResponse.Content.ReadFromJsonAsync<JsonElement>(cancellationToken);
            var taskId = publishResult.GetProperty("taskId").GetString();

            // Poll for result
            var startTime = DateTime.UtcNow;
            var timeout = TimeSpan.FromSeconds(_defaultTimeout);

            while (DateTime.UtcNow - startTime < timeout)
            {
                cancellationToken.ThrowIfCancellationRequested();

                try
                {
                    var statusResponse = await _httpClient.GetAsync(
                        $"{_coordinatorUrl}/v1/tasks/{taskId}",
                        cancellationToken
                    );

                    if (statusResponse.IsSuccessStatusCode)
                    {
                        var statusResult = await statusResponse.Content.ReadFromJsonAsync<JsonElement>(cancellationToken);
                        var status = statusResult.GetProperty("status").GetString();

                        if (status == "completed")
                        {
                            var result = statusResult.GetProperty("result");
                            if (result.TryGetProperty("output", out var output))
                            {
                                return output.ToString();
                            }
                            if (result.TryGetProperty("text", out var text))
                            {
                                return text.ToString();
                            }
                            return result.ToString();
                        }
                        else if (status == "failed" || status == "cancelled")
                        {
                            var error = statusResult.TryGetProperty("error", out var e) 
                                ? e.GetString() 
                                : "Unknown error";
                            return $"Task {status}: {error}";
                        }
                    }
                }
                catch (Exception)
                {
                    // Ignore polling errors, retry
                }

                await Task.Delay(2000, cancellationToken);
            }

            return $"Task timed out after {_defaultTimeout}s. Task ID: {taskId}";
        }
        catch (Exception ex)
        {
            return $"Error: {ex.Message}";
        }
    }

    public async Task<List<AgentInfo>> DiscoverAgentsAsync(
        string query,
        int limit,
        CancellationToken cancellationToken)
    {
        try
        {
            var response = await _httpClient.PostAsJsonAsync(
                $"{_registryUrl}/v1/agent/discovery",
                new { query, limit },
                cancellationToken
            );

            if (response.IsSuccessStatusCode)
            {
                var result = await response.Content.ReadFromJsonAsync<DiscoveryResult>(cancellationToken);
                return result?.Agents ?? new List<AgentInfo>();
            }
        }
        catch (Exception)
        {
            // Ignore errors
        }

        return new List<AgentInfo>();
    }

    public void Dispose()
    {
        _httpClient.Dispose();
    }
}

public class DiscoveryResult
{
    public List<AgentInfo> Agents { get; set; } = new();
}

public class AgentInfo
{
    public string Did { get; set; } = "";
    public string Name { get; set; } = "";
    public string Endpoint { get; set; } = "";
    public List<CapabilityInfo> Capabilities { get; set; } = new();
}

public class CapabilityInfo
{
    public string Id { get; set; } = "";
    public string Description { get; set; } = "";
    public int PriceCents { get; set; }
}
