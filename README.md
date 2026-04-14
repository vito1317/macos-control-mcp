# macos-control-mcp

MCP Server，讓 AI 完全操控你的 macOS 電腦 — 滑鼠、鍵盤、終端機、截圖、視窗管理、UI 元件偵測，並提供 AI 優化的資訊回報。

## 功能模組

### 🖱️ 滑鼠控制
- `mouse_move` — 移動滑鼠到指定座標
- `mouse_click` — 點擊（左/右/中鍵，單擊/雙擊/三擊）
- `mouse_drag` — 拖曳操作
- `mouse_scroll` — 滾輪捲動
- `mouse_position` — 取得目前滑鼠位置

### ⌨️ 鍵盤輸入
- `keyboard_type` — 打字輸入（支援中文、日文、emoji）
- `keyboard_press` — 按鍵 + 修飾鍵組合
- `keyboard_hotkey` — 快捷鍵組合（如 `cmd+c`）

### 📸 截圖與螢幕分析
- `screenshot` — 全螢幕/區域截圖，支援座標格線疊加
- `screenshot_annotated` — 標註特定點位的截圖
- `screen_info` — 螢幕解析度、位置、縮放比例

### 💻 終端機操作
- `terminal_execute` — 執行 shell 指令
- `terminal_execute_background` — 背景執行長時間指令
- `terminal_applescript` — 執行 AppleScript

### 🪟 視窗管理
- `window_list` — 列出所有可見視窗
- `window_focus` — 切換/聚焦應用程式
- `window_resize` — 移動和調整視窗大小
- `window_minimize` — 最小化視窗
- `window_close` — 關閉視窗
- `apps_list` — 列出所有執行中的應用程式

### ♿ Accessibility API 元件偵測
- `accessibility_check` — 檢查無障礙權限
- `accessibility_tree` — 取得 UI 元件樹（按鈕、輸入框、標籤等位置和屬性）
- `accessibility_element_at` — 取得指定座標的 UI 元件
- `accessibility_click` — 透過 Accessibility API 點擊元件（比座標更可靠）

### 🤖 AI 資訊優化工具
- `ai_screen_context` — **一鍵取得完整螢幕上下文**（截圖+座標格線+Accessibility 樹+滑鼠位置）
- `ai_find_element` — 用自然語言搜尋 UI 元件
- `ai_ocr_region` — 區域 OCR 文字辨識（使用 macOS Vision framework）
- `clipboard_read` / `clipboard_write` — 剪貼簿讀寫

## 安裝

### 前置需求
- macOS 13+
- Node.js 18+
- Xcode Command Line Tools（`xcode-select --install`）

### 一鍵安裝
```bash
curl -fsSL https://raw.githubusercontent.com/vito1317/macos-control-mcp/main/install.sh | bash
```

### 手動安裝
```bash
# Clone
git clone https://github.com/vito1317/macos-control-mcp.git ~/.local/share/macos-control-mcp
cd ~/.local/share/macos-control-mcp

# Build
npm install && npm run setup

# 註冊 MCP
claude mcp add macos-control -s user -- node ~/.local/share/macos-control-mcp/dist/index.js
```

## 使用方式

```bash
# 註冊 MCP
claude mcp add macos-control -s user -- node ~/.local/share/macos-control-mcp/dist/index.js

# 移除 MCP
claude mcp remove macos-control -s user

# 更新
cd ~/.local/share/macos-control-mcp && git pull && npm run setup

# 完整移除
claude mcp remove macos-control -s user && rm -rf ~/.local/share/macos-control-mcp
```

## 權限設定

安裝後需要在系統設定中授予權限：
- **System Settings > Privacy & Security > Accessibility** — 加入你的終端機應用
- **System Settings > Privacy & Security > Screen Recording** — 加入你的終端機應用

## 設定（進階）

### 手動 JSON 設定
也可直接編輯 MCP 設定檔：
```json
{
  "mcpServers": {
    "macos-control": {
      "command": "node",
      "args": ["~/.local/share/macos-control-mcp/dist/index.js"]
    }
  }
}
```

### 權限設定
必須授予 **Accessibility 權限**：
> System Settings → Privacy & Security → Accessibility → 加入你的終端機應用程式

## 架構

```
macos-control-mcp/
├── src/
│   ├── index.ts              # MCP Server 進入點
│   ├── server.ts             # 伺服器設定與工具註冊
│   ├── tools/
│   │   ├── mouse.ts          # 滑鼠控制
│   │   ├── keyboard.ts       # 鍵盤輸入
│   │   ├── screenshot.ts     # 截圖與螢幕分析
│   │   ├── terminal.ts       # 終端機操作
│   │   ├── window.ts         # 視窗管理
│   │   ├── accessibility.ts  # UI 元件偵測
│   │   └── ai-optimize.ts    # AI 資訊優化
│   ├── utils/
│   │   ├── swift-bridge.ts   # Swift 原生助手橋接
│   │   └── image.ts          # 影像處理（格線、壓縮、標註）
│   └── types/
│       └── index.ts          # TypeScript 型別定義
├── swift-helpers/
│   ├── MacControl.swift      # Swift 原生助手（CoreGraphics, Accessibility API）
│   └── build.sh              # Swift 編譯腳本
└── bin/                      # 編譯後的 Swift binary
```

## AI 使用建議

AI Agent 操控電腦的推薦流程：

1. **觀察** — 呼叫 `ai_screen_context` 取得完整螢幕狀態
2. **定位** — 使用 `ai_find_element` 搜尋目標元件，或從截圖座標格線判斷位置
3. **操作** — 使用 `mouse_click`、`keyboard_type`、`keyboard_hotkey` 等工具互動
4. **驗證** — 再次呼叫 `ai_screen_context` 確認操作結果

## License

MIT
