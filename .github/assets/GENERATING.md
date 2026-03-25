# Generating the Demo

Three options, from easiest to most polished:

## Option 1: Termstage (easiest, SVG output, no heavy deps)

```sh
pipx install termstage
cd .github/assets
termstage render demo.yaml -o demo.svg
```

Produces a pure-CSS animated SVG. Lightweight, vector, renders natively on GitHub.

## Option 2: VHS (industry standard, GIF output)

```sh
# macOS
brew install charmbracelet/tap/vhs

# Generates demo.gif
vhs demo.tape
```

Requires ffmpeg, ttyd, and headless Chrome (all installed via brew).

## Option 3: Live recording with VHS

```sh
vhs record -o demo.gif
```

Opens an interactive terminal. Run through the flow manually, press Ctrl+C when done.

## Option 4: asciinema + svg-term (vector, high quality)

```sh
# Record
asciinema rec demo.cast

# Convert to animated SVG
npx svg-term-cli --in demo.cast --out demo.svg --window --no-cursor --width 80 --height 30
```

## After generating

Update the README to reference the file:

```html
<!-- For SVG -->
<p align="center"><img src=".github/assets/demo.svg" width="600" alt="Nooterra demo"></p>

<!-- For GIF -->
<p align="center"><img src=".github/assets/demo.gif" width="600" alt="Nooterra demo"></p>
```
