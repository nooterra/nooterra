import sys
from pathlib import Path

# Add the ml-sidecar/src directory to Python path so tests can import modules directly
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))
