# Design System Document: The Sovereign Ledger

## 1. Overview & Creative North Star
**Creative North Star: "The Architectural Editor"**
This design system moves beyond the utility of standard fintech tools to provide a sense of architectural permanence and editorial clarity. For Nooterra, we are not just displaying data; we are curating financial health. 

The system rejects the "boxed-in" nature of traditional SaaS. We achieve a premium feel through **intentional asymmetry**, high-contrast typography, and **tonal layering**. By favoring white space over structural lines, the UI feels expansive, authoritative, and impossibly clean—mimicking the layout of a high-end financial broadsheet or a modern architectural blueprint.

---

## 2. Colors & Surface Philosophy
The palette utilizes deep, authoritative charcoals and crisp whites, punctuated by a high-energy "Electric Acid" accent (#DDF047).

### Tonal Strategy
*   **Primary (#5a6400 / #ddf047):** Used sparingly to draw the eye to critical recovery actions or "success" states.
*   **Surface Hierarchy:** We utilize a "light-to-dark" depth model. The base `surface` (#f8f9ff) acts as our floor, while `surface-container-lowest` (#ffffff) acts as our primary content sheet.

### The "No-Line" Rule
**Strict Mandate:** 1px solid borders are prohibited for sectioning or grouping content. 
Structure is created through:
*   **Background Shifts:** Place a `surface-container-low` (#eff4ff) block against a `surface` background.
*   **Negative Space:** Use the spacing scale to create invisible boundaries.

### The Glass & Gradient Rule
To prevent the UI from feeling "flat," use Glassmorphism for floating navigation or overlay modals. Use `surface` at 80% opacity with a `20px` backdrop-blur. Main CTAs should utilize a subtle linear gradient from `primary` (#5a6400) to `primary_container` (#ddf047) at a 135-degree angle to add "soul" and dimension.

---

## 3. Typography: The Editorial Voice
We use **Inter** (as a high-performance alternative to Lausanne) to establish a clean, Swiss-inspired typographic grid.

*   **Display & Headlines:** Use `display-lg` and `headline-lg` with tight tracking (-0.02em) to create an authoritative, "New York Times" financial desk aesthetic.
*   **Contrast is King:** Pair large headlines with `label-md` or `label-sm` in all-caps with increased letter spacing (+0.05em) for metadata. This "Big & Small" contrast is the hallmark of premium editorial design.
*   **Visual Hierarchy:** Titles (`title-lg`) must always be `on_surface` (#0d1c2e), while helper text uses `secondary` (#515f74) to create a clear reading path.

---

## 4. Elevation & Depth
In this system, "Elevation" is a state of light, not a drop shadow.

*   **The Layering Principle:** Stack containers to create importance. 
    *   *Example:* Dashboard (Surface) > Widget Group (Surface-Container-Low) > Specific Invoice Card (Surface-Container-Lowest).
*   **Ambient Shadows:** If a card must float, use a "Cloud Shadow": `y-20, blur-40, color: on_surface @ 4%`. It should be felt, not seen.
*   **The "Ghost Border" Fallback:** If accessibility requires a border (e.g., in high-contrast mode), use `outline_variant` (#c7c8af) at **15% opacity**. 100% opaque borders are considered a "system failure."
*   **Glassmorphism:** Use for persistent elements like sidebars or top navigation to allow Nooterra’s data visualizations to peek through, keeping the user grounded in their financial data.

---

## 5. Components

### Buttons
*   **Primary:** Sharp corners (`rounding: sm - 0.125rem`). Gradient fill (Primary to Primary-Container). Text: `on_primary`. 
*   **Secondary:** Ghost style. No fill, `Ghost Border` (outline-variant @ 20%).
*   **Interaction:** On hover, primary buttons should shift +2px vertically with an Ambient Shadow.

### Cards & Data Lists
*   **Forbidden:** Horizontal divider lines (`<hr>`).
*   **Structure:** Use `24px` vertical padding between list items. Use a `surface-container-high` background on hover to indicate interactivity.
*   **Invoicing Tables:** Use a "Zebraless" approach. Distinguish rows through subtle typographic weight shifts rather than alternating row colors.

### Input Fields
*   **Visual Style:** Bottom-border only or very subtle `surface-container-highest` fills. 
*   **States:** Error states use `error` (#ba1a1a) text but never a thick red box. Use a small 2px "indicator pill" to the left of the input instead.

### Data Visualizations (Signature Component)
*   **The Recovery Graph:** Use a combination of solid `primary` lines and "Area Glow" (a gradient of the primary color fading to 0% opacity). 
*   **Micro-interactions:** Tooltips must be Glassmorphic with a `surface-container-highest` tint.

---

## 6. Do’s and Don’ts

### Do:
*   **Embrace the Void:** Use more white space than you think is necessary. Space is a luxury.
*   **Asymmetric Layouts:** Offset a headline to the left while the data sits to the right to break the "standard template" feel.
*   **Sharp Points:** Keep `rounding` at `sm` (0.125rem) or `none`. This communicates "Precision Fintech."

### Don’t:
*   **Don't use 100% Black:** Use `on_background` (#0d1c2e) for text. It’s softer and more premium than #000000.
*   **Don't use Center-Alignment:** For financial tools, left-alignment communicates progress and stability. Center-alignment is for marketing, not for tools.
*   **Don't use standard Shadows:** Avoid any shadow that looks "heavy" or "dirty." If the shadow looks grey, it’s too dark. Tint it with the brand’s blue/charcoal.