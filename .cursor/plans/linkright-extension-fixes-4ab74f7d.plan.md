<!-- 4ab74f7d-4acc-4ba8-b5c1-3674785d28b5 ce7b0a9e-be49-454b-be21-0831d0206150 -->
# LinkRight Extension Fixes

## 1. Fix Extension Icon Click Behavior

**File**: `background.js` (lines 55-68)

Current: Extension icon always sends OPEN_SIDEBAR message

Fix: Track extension state to prevent opening when sidebar/sticky tab already visible

- Add state tracking in chrome.storage for `extensionActive` flag
- Modify `chrome.action.onClicked` handler to only open sidebar if extension not active
- Set `extensionActive: true` when sidebar opens
- Set `extensionActive: false` when sticky tab X is clicked

## 2. Increase Sidebar Width by 10%

**File**: `sidebar.css` (line 29)

Current: `--sidebar-width: 320px;`

Fix: `--sidebar-width: 352px;` (320 * 1.10 = 352px)

Also update mobile breakpoint at line 536 from 280px to 308px

## 3. Increase Sticky Tab Size by 10%

**File**: `sidebar.css` - Update `.linkright-mini-icon` dimensions

Current: 48px x 48px

Fix: 53px x 53px (48 * 1.10 ≈ 53px)

Update border-radius proportionally from 12px to 13px

## 4. Add Hover UI Elements and Animation to Sticky Tab

**File**: `content.js` - `showMiniIcon()` method (around line 85-124)

Add HTML for:

- Small X button (top-left corner, shows on hover with tooltip "Remove sticky tab")
- Drag indicator with 6 dots (right side, shows on hover)

**File**: `sidebar.css` - Update sticky tab positioning and add new styles:

```css
/* Sticky tab base - positioned flush with right edge */
.linkright-mini-icon {
  width: 53px;
  height: 53px;
  border-radius: 13px;
  position: fixed;
  right: 0; /* Flush with right edge */
  transition: transform 0.2s ease, opacity 0.2s ease;
  /* existing styles... */
}

/* Hover animation - unwrap to the left */
.linkright-mini-icon:hover {
  transform: translateX(-8px); /* Move left by 8px on hover */
}

/* Sticky tab X button (hidden by default, shown on hover) */
.linkright-mini-close-btn {
  position: absolute;
  top: 4px;
  left: 4px;
  width: 16px;
  height: 16px;
  opacity: 0;
  transition: opacity 0.2s;
  cursor: pointer;
  background: rgba(239, 68, 68, 0.1);
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--destructive);
}

.linkright-mini-close-btn:hover {
  background: rgba(239, 68, 68, 0.2);
}

.linkright-mini-icon:hover .linkright-mini-close-btn {
  opacity: 1;
}

/* Drag indicator dots (shown on hover) */
.linkright-drag-indicator {
  position: absolute;
  right: 6px;
  top: 50%;
  transform: translateY(-50%);
  display: grid;
  grid-template-columns: repeat(2, 4px);
  grid-template-rows: repeat(3, 4px);
  gap: 3px;
  opacity: 0;
  transition: opacity 0.2s;
}

.linkright-mini-icon:hover .linkright-drag-indicator {
  opacity: 1;
}

.linkright-drag-dot {
  width: 4px;
  height: 4px;
  background: var(--secondary);
  border-radius: 50%;
}
```

## 4. Fix Sticky Tab X Button Behavior

**File**: `content.js` - `showMiniIcon()` method

Add click handler for X button:

- Stop event propagation to prevent sticky tab click
- Call new method `closeStickyTab()`
- Set `extensionActive: false` in storage
- Hide sticky tab completely

Add new method `closeStickyTab()`:

```javascript
closeStickyTab() {
  this.hideMiniIcon();
  this.extensionActive = false;
  chrome.storage.local.set({ extensionActive: false });
}
```

## 5. Fix Sticky Tab Click to Open Sidebar

**File**: `content.js` - `openSidebarFromMiniIcon()` method (line 544)

Current behavior is correct but needs to:

- Ensure sticky tab is hidden when sidebar opens
- Reset currentView to 'main' so main content shows

## 6. Fix Sidebar Always Opens at Top-Right

**File**: `content.js` - `openSidebar()` method (line 518)

Current implementation already forces `top: 0px` - verify this is working correctly.

## 7. Fix Sidebar Jumping Issue

**File**: `content.js` - `closeSidebar()` method (line 552)

Issue: Sidebar position is set with `-var(--sidebar-width)` as string, should be actual pixel value

Fix:

```javascript
this.sidebar.style.right = '-352px'; // Use actual pixel value instead of CSS variable
```

## 8. Add Extension State Tracking

**File**: `content.js` - Add new property in constructor (line 10)

Add: `this.extensionActive = false;`

Update state when:

- Sidebar opens: `extensionActive = true`
- Sticky tab appears: `extensionActive = true`
- Sticky tab X clicked: `extensionActive = false`

Save to chrome.storage.local for persistence across page loads.

## 9. Update Message Handler for Extension Icon Click

**File**: `content.js` - `setupEventListeners()` method (line 599)

Current: Always opens sidebar on OPEN_SIDEBAR_FROM_EXTENSION

Fix: Only open if extensionActive is false

```javascript
else if (message.type === 'OPEN_SIDEBAR_FROM_EXTENSION') {
  if (!this.extensionActive) {
    console.log('LinkRight: Opening sidebar from extension icon click');
    this.currentView = 'main'; // Ensure we show main content
    this.openSidebar();
    this.extensionActive = true;
    chrome.storage.local.set({ extensionActive: true });
  } else {
    console.log('LinkRight: Extension already active, ignoring click');
  }
}
```

## 10. Load Extension State on Init

**File**: `content.js` - `loadState()` method (line 60)

Add loading of `extensionActive` flag:

```javascript
chrome.storage.local.get(['engagementMode', 'miniIconPosition', 'extensionActive'], (result) => {
  this.engagementMode = result.engagementMode || false;
  this.miniIconPosition = result.miniIconPosition || { top: 200 };
  this.extensionActive = result.extensionActive || false;
  resolve();
});
```

If `extensionActive` is true on load, show sticky tab.

## 11. Add Home/Back Button to Header

**File**: `content.js` - `getHeaderContent()` method (line 233)

Add home button that appears when currentView is not 'main':

```javascript
getHeaderContent() {
  const showHomeButton = this.currentView !== 'main';
  return `
    <div class="linkright-header-left">
      ${showHomeButton ? `
        <button class="linkright-header-btn" data-action="home" title="Back to Home">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <path d="M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z"/>
          </svg>
        </button>
      ` : ''}
      <div class="linkright-logo">🎯</div>
      <div class="linkright-title">LinkRight</div>
    </div>
    <div class="linkright-header-right">
      ...existing buttons...
    </div>
  `;
}
```

**File**: `content.js` - `handleHeaderAction()` method

Add case for 'home':

```javascript
case 'home':
  console.log('LinkRight: Home button clicked');
  this.currentView = 'main';
  this.updateSidebarContent(this.sidebar);
  break;
```

## 12. Add Privacy Policy Link to Footer

**File**: `content.js` - `getMainContentDefault()` method (around line 320)

Add footer at the end of content:

```javascript
getMainContentDefault() {
  return `
    <div class="linkright-tabs">
      ...existing tabs...
    </div>
    
    <div class="linkright-content-area">
      ...existing content...
      
      <div class="linkright-footer">
        <a href="#" class="linkright-privacy-link" id="linkright-privacy-link">
          Privacy Policy
        </a>
      </div>
    </div>
  `;
}
```

Add event listener in `addSidebarEventListeners()`:

```javascript
// Privacy policy link
const privacyLink = sidebar.querySelector('#linkright-privacy-link');
if (privacyLink) {
  privacyLink.addEventListener('click', (e) => {
    e.preventDefault();
    const url = window.LINKRIGHT_CONFIG?.PRIVACY_POLICY_URL;
    if (url && url !== '[PRIVACY_POLICY_URL]') {
      window.open(url, '_blank');
    }
  });
}
```

## 13. Add Privacy Policy Footer Styles

**File**: `sidebar.css`

Add footer styles for privacy policy:

```css
/* Footer - Privacy Policy */
.linkright-footer {
  margin-top: auto;
  padding: 16px 0 0 0;
  border-top: 1px solid var(--border);
}

.linkright-privacy-link {
  display: block;
  text-align: center;
  color: var(--secondary);
  font-size: 12px;
  text-decoration: none;
  padding: 8px;
  transition: color 0.2s ease;
}

.linkright-privacy-link:hover {
  color: var(--primary);
}
```

Update `.linkright-sidebar-content` to use flexbox:

```css
.linkright-sidebar-content {
  flex: 1;
  overflow-y: auto;
  padding: 20px;
  display: flex;
  flex-direction: column;
}
```

## 14. Add Light Teal Background to Extension

**File**: `sidebar.css`

Update `.linkright-sidebar` background:

```css
.linkright-sidebar {
  ...
  background: #F0F8F8; /* Very light teal instead of pure white */
  ...
}
```

Update CSS variable for light mode:

```css
:root {
  --background: #F0F8F8; /* Very light teal */
  ...
}
```

## Testing Checklist

1. Click extension icon → sidebar opens with main content
2. Click extension icon again → nothing happens (sidebar still open)
3. Click sidebar X → sidebar closes, sticky tab appears
4. Hover over sticky tab → X button (top-left) and 6 drag dots (right) appear
5. Click sticky tab X → sticky tab disappears completely
6. Click extension icon → sidebar opens again with main content
7. Click sticky tab body → sidebar opens with main content, sticky tab disappears
8. Click settings button → settings view shows with home button visible
9. Click home button → returns to main content with 4 feature buttons
10. Privacy policy link visible at bottom of sidebar in main view
11. Click privacy policy → opens in new tab
12. Sidebar has light teal background (#F0F8F8)
13. Sidebar width is ~352px (10% wider)
14. Drag sticky tab to bottom → click sticky tab → sidebar opens at top-right