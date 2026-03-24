# Homebrew formula for Nooterra CLI
# Install: brew tap nooterra/tap && brew install nooterra
# Or: brew install nooterra/tap/nooterra

class Nooterra < Formula
  desc "Hire AI workers you can actually trust. Autonomous workers with built-in guardrails."
  homepage "https://nooterra.ai"
  license "MIT"

  # Version is pulled from package.json at release time
  version "0.2.8"

  # Binary releases will be hosted on GitHub Releases
  on_macos do
    on_arm do
      url "https://github.com/nooterra/nooterra/releases/download/v#{version}/nooterra-darwin-arm64.tar.gz"
      sha256 "PLACEHOLDER_SHA256_DARWIN_ARM64"
    end
    on_intel do
      url "https://github.com/nooterra/nooterra/releases/download/v#{version}/nooterra-darwin-x64.tar.gz"
      sha256 "PLACEHOLDER_SHA256_DARWIN_X64"
    end
  end

  on_linux do
    on_arm do
      url "https://github.com/nooterra/nooterra/releases/download/v#{version}/nooterra-linux-arm64.tar.gz"
      sha256 "PLACEHOLDER_SHA256_LINUX_ARM64"
    end
    on_intel do
      url "https://github.com/nooterra/nooterra/releases/download/v#{version}/nooterra-linux-x64.tar.gz"
      sha256 "PLACEHOLDER_SHA256_LINUX_X64"
    end
  end

  def install
    bin.install "nooterra"
  end

  def caveats
    <<~EOS
      To get started:
        nooterra

      This will launch the TUI and guide you through:
        1. Sign in to Nooterra
        2. Connect your AI provider (OpenAI, Anthropic, etc.)
        3. Create your first worker
        4. Run your first governed task

      Documentation: https://nooterra.ai/docs
      Support: https://nooterra.ai/support
    EOS
  end

  test do
    assert_match "nooterra", shell_output("#{bin}/nooterra --version")
  end
end
