# Tabbed Interface Usage Guide

## How to Use the New Interface

### **Viewing the Three Horizons**

When you scroll to the **Three Horizons Framework** section, you'll see each horizon has three tabs at the top:

```
[Transport & Logistics] [Real Estate] [Financing]
     (active/blue)         (inactive)     (inactive)
```

### **Switching Between Business Verticals**

**Click any tab button** to see use cases for that specific business vertical.

Example for **Horizon 1**:
- Click **"Transport & Logistics"** → See 9 logistics use cases (Quick Wins + Foundation Builds)
- Click **"Real Estate"** → See 1 real estate use case (Lease Analysis)
- Click **"Financing"** → See 2 financing use cases (Credit Scoring, Collections)

### **Understanding the Yellow Icons**

Each use case has a **yellow icon** on the left that indicates the technology type:

| Icon | Technology Type | Description |
|------|----------------|-------------|
| 🔍 | Traditional Analytics | Pattern recognition, data analysis |
| 🎲 | Predictive AI | Forecasting, prediction models |
| 🛣️ | Optimization AI | Route optimization, resource allocation |
| 📷 | Computer Vision | Visual inspection, image recognition |
| 💬 | LLM-Powered | Large language models, natural language |
| 🤖 | AI Agent | Autonomous decision-making agents |

**Hover over any icon** to see a tooltip with the technology name.

---

## Tab Behavior by Horizon

### **Horizon 1: Mitigate Risk & Build Foundation**
- **Default Tab**: Transport & Logistics (most use cases)
- **Content**: Mix of Quick Wins (3-6 months) and Foundation Builds (6-12 months)
- **Icon Mix**: Mostly traditional analytics, predictive AI, and LLMs

### **Horizon 2: Capture Opportunities & Differentiate**
- **Default Tab**: Transport & Logistics
- **Content**: AI Agents dominate this horizon
- **Icon Mix**: Primarily CPU icons (AI Agents) with some predictive AI

### **Horizon 3: Anticipate the Future & Lead**
- **Default Tab**: Transport & Logistics
- **Content**: Strategic foresight and scenario planning
- **Icon Mix**: LLMs for scenario planning, predictive AI for long-term forecasting, AI Agents for orchestration

---

## Visual Example

### Before (Overwhelming):
```
Horizon 1: Mitigate Risk & Build Foundation
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
→ Use Case 1 (Logistics)
→ Use Case 2 (Logistics)
→ Use Case 3 (Logistics)
→ Use Case 4 (Real Estate)
→ Use Case 5 (Financing)
→ Use Case 6 (Logistics)
→ Use Case 7 (Logistics)
→ Use Case 8 (Logistics)
→ Use Case 9 (Logistics)
→ Use Case 10 (Financing)
→ Use Case 11 (Logistics)
→ Use Case 12 (Logistics)
(12 items mixed together - overwhelming!)
```

### After (Organized):
```
Horizon 1: Mitigate Risk & Build Foundation
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
[Transport & Logistics] [Real Estate] [Financing]

─── Transport & Logistics Tab (Active) ───
🔍 Use Case 1
🔍 Use Case 2
🎲 Use Case 3
💬 Use Case 4
💬 Use Case 5
💬 Use Case 6
📷 Use Case 7
🛣️ Use Case 8
🛣️ Use Case 9
(9 related items - manageable!)

Click "Real Estate" → See 1 item
Click "Financing" → See 2 items
```

---

## Mobile Experience

On **mobile devices** (screen width < 768px):
- Tabs stack **vertically** instead of horizontally
- Active tab has a **left border** (blue) and **light background**
- Tap any tab to switch content
- Content fades in smoothly

---

## Keyboard Navigation (Future Enhancement)

*Not yet implemented, but recommended:*
- `Tab` key: Move between tab buttons
- `Enter/Space`: Activate selected tab
- `Arrow Left/Right`: Move between tabs

---

## Deep Linking (Future Enhancement)

*Not yet implemented, but recommended:*
- URL structure: `#h1-logistics`, `#h2-realestate`, `#h3-financing`
- Allows sharing specific tab views
- Browser back/forward works with tabs

---

## Design Philosophy

### Why Tabs?
- **Reduce Cognitive Load**: Show only relevant content
- **Respect User Intent**: Logistics-focused readers see logistics first
- **Maintain Comprehensiveness**: All content still accessible
- **Modern UX Pattern**: Familiar interface from other enterprise tools

### Why Yellow Icons?
- **Visual Hierarchy**: Icons complement Klein blue brand color
- **Instant Recognition**: No need to read verbose labels
- **Professional Aesthetic**: Clean, modern design
- **Accessibility**: Tooltips provide text alternative

### Why This Structure?
- **Business Vertical Organization**: Respects TransInvest's autonomous structure
- **Technology Abstraction**: Icons hide complexity
- **Progressive Disclosure**: See what matters, click for more
- **Scalable Pattern**: Easy to add more use cases or verticals

---

## Testing Checklist

✅ All three horizons have tabbed interface  
✅ Default tab (Transport & Logistics) displays correctly  
✅ Clicking tabs switches content smoothly  
✅ Yellow icons render with correct colors  
✅ Icon tooltips show on hover  
✅ Active tab highlighted with blue color  
✅ Content fades in with animation  
✅ Mobile responsive design works  
✅ No console errors  
✅ Lucide icons load from CDN  

---

## Troubleshooting

**Icons not appearing?**
- Check browser console for CDN errors
- Ensure `lucide.createIcons()` runs after DOM load
- Verify icon names match Lucide library

**Tabs not switching?**
- Check JavaScript console for errors
- Verify `initializeTabs()` function executed
- Check data attributes match: `data-tab` and `data-tab-content`

**Yellow color not showing?**
- Verify `.tech-icon svg` CSS rule applies
- Check stroke color is `#FFB700`
- Ensure icon elements have class `tech-icon`

---

**Created**: 2025-11-12  
**Status**: Production Ready ✅
