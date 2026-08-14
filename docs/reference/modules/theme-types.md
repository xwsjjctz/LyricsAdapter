# `types/theme.ts` — 主题配置类型

## 文件概述

定义应用的**主题系统类型**，包括颜色、字体、圆角等视觉属性。与 `services/themeManager.ts` 和 `services/themes/predefinedThemes.ts` 配合实现完整的主题切换功能。

```typescript
// 位置：./types/theme.ts
// 依赖：无（纯类型 + 常量）
```

---

## 接口 (Interface)

### `ThemeColors`

```typescript
export interface ThemeColors {
  // Primary colors
  primary: string;
  primaryHover: string;
  primaryLight: string;
  // Background colors
  backgroundDark: string;
  backgroundGradientStart: string;
  backgroundGradientEnd: string;
  backgroundSidebar: string;
  backgroundCard: string;
  backgroundCardHover: string;
  // Text colors
  textPrimary: string;
  textSecondary: string;
  textMuted: string;
  // Border colors
  borderLight: string;
  borderHover: string;
  // Accent colors
  accent: string;
  accentHover: string;
  // Status colors
  success: string;
  warning: string;
  error: string;
  info: string;
  // Special effects
  shadowColor: string;
  glowColor: string;
}
```

**说明：** 主题颜色配置，共 22 个色值字段，分 7 类：

| 类别 | 字段 | 用途 |
|------|------|------|
| 主色 | `primary`, `primaryHover`, `primaryLight` | 品牌主色、悬停和浅色变体 |
| 背景 | `backgroundDark` ~ `backgroundCardHover` | 各层级背景色 |
| 文字 | `textPrimary`, `textSecondary`, `textMuted` | 文字色阶 |
| 边框 | `borderLight`, `borderHover` | 边框及悬停态 |
| 强调 | `accent`, `accentHover` | 强调色 |
| 状态 | `success`, `warning`, `error`, `info` | 状态指示色 |
| 特效 | `shadowColor`, `glowColor` | 阴影和发光效果 |

---

### `ThemeFonts`

```typescript
export interface ThemeFonts {
  main: string;
  display?: string;
  mono?: string;
}
```

**说明：** 字体配置，指定 CSS `font-family` 值。

| 字段 | 类型 | 说明 |
|------|------|------|
| `main` | `string` | 正文字体 |
| `display` | `string?` | 标题/展示字体 |
| `mono` | `string?` | 等宽字体 |

---

### `ThemeBorderRadius`

```typescript
export interface ThemeBorderRadius {
  sm: string;
  md: string;
  lg: string;
  xl: string;
  full: string;
}
```

**说明：** 圆角配置，五个梯度等级。

---

### `ThemeConfig`

```typescript
export interface ThemeConfig {
  id: ThemeId;
  name: string;
  description: string;
  icon: string;
  colors: ThemeColors;
  fonts: ThemeFonts;
  borderRadius: ThemeBorderRadius;
  tags: string[];
  isDark: boolean;
}
```

**说明：** 完整主题配置，包含标识、描述、视觉属性和分类标签。

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | `ThemeId` | 主题唯一标识 |
| `name` | `string` | 显示名称 |
| `description` | `string` | 主题描述 |
| `icon` | `string` | 图标（Material Symbols 名称） |
| `colors` | `ThemeColors` | 颜色 |
| `fonts` | `ThemeFonts` | 字体 |
| `borderRadius` | `ThemeBorderRadius` | 圆角 |
| `tags` | `string[]` | 标签，如 `['dark', 'nature']` |
| `isDark` | `boolean` | 是否为深色主题 |

---

## 常量 (Constant)

### `THEME_IDS`

```typescript
export const THEME_IDS = {
  DEFAULT: 'default',
  CUTE: 'cute',
  OCEAN: 'ocean',
  SUNSET: 'sunset',
  FOREST: 'forest',
  MIDNIGHT: 'midnight',
  WARM: 'warm',
  GLACIER: 'glacier',
} as const;
```

- **说明：** 预定义主题 ID 常量，用 `as const` 确保字面量类型
- **特性：** 使用 `as const` 断言，使得每个属性值成为字面量类型而非 `string`

---

## 类型别名 (Type Alias)

### `ThemeId`

```typescript
export type ThemeId = typeof THEME_IDS[keyof typeof THEME_IDS];
```

- **说明：** 联合类型，值为 `THEME_IDS` 常量的所有 value 的联合：`'default' | 'cute' | 'ocean' | 'sunset' | 'forest' | 'midnight' | 'warm' | 'glacier'`
- **设计意图：** 通过 `typeof THEME_IDS[keyof typeof THEME_IDS]` 从常量派生类型，保证键和类型同步，避免定义重复字符串

---

## 设计要点

1. **类型约束严格**：所有颜色、字体、圆角字段都是必填（非可选），确保主题切换后所有视觉属性都有值
2. **`as const` + 类型派生**：`THEME_IDS` 用 `as const` 固定字面量，`ThemeId` 经由 `keyof typeof` 派生，达到"单点修改"效果
3. **语义命名**：颜色字段用语义名（`primary`、`textPrimary`）而非色值名（`blue`、`gray100`），更贴近设计师思维
4. **标签系统**：`tags` 字段支持主题分类筛选，后续可用于主题市场或自动推荐
