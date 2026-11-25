# 我的日历

一个可以自己选照片的 iPhone PWA 日历（2026 年 11 月至 2027 年 12 月）。站点：<https://zunyaner.github.io/calendar-diy/>

- 仓库里**没有任何照片**。首页大图和每个月的日历背景默认留空，显示「点击添加照片」。
- 点首页大图或月份卡片上的相机图标，从相册选图，在裁剪器里拖动、双指或滑块缩放，按首页 4:3 取景。浏览器里用 canvas 压缩（长边约 1600），同时生成首页大图、年视图缩略图、月历背景。
- 照片保存在这台设备浏览器的 IndexedDB 里，**不上传**，也不进 Service Worker 缓存。
- **批量添加照片**（设置或全年总览右上角）：一次从相册选多张，按选择顺序自动填到本月起空着的月份（居中裁剪），多出的不使用；之后可逐张「调整位置和大小」。
- 设置里可「导出备份 / 导入备份」（JSON，含事项、首页一句话和照片原图）和「清空全部图片」。
- 功能：2027 国家法定节假日与调休（国办发明电〔2026〕10号）、农历、节气、待办、本月 / 全年视图。待办存 localStorage。

## 在 iPhone 上使用

用 Safari 打开站点，分享按钮 → 添加到主屏幕。

## 已知限制

- iOS Safari 可能在存储吃紧或网站长期未使用时清理站点数据，请定期导出备份。
- 应用图标是固定的通用日历图标，不能由用户更换。
- 更新应用后，用 Safari 打开一次站点即可刷新（SW 缓存名 `cal2027-diy-v3`）。

## 安卓版（APK）

`android/` 是 Capacitor 安卓工程，把本仓库的网页资源打包进应用（离线可用，不依赖网站，应用内不注册 Service Worker）。

- 应用名「我的日历」，包名 `io.github.zunyaner.calendardiy`，minSdk 24。
- 图片、事项保存在应用自己的 WebView 本地存储（IndexedDB / localStorage），不上传。导出备份、导出节假日 .ics 通过系统分享面板保存。
- 构建：`npm install && npm run sync && cd android && ./gradlew assembleRelease`（需要 JDK 21、Android SDK 36）。签名密钥放在仓库外（`CALENDAR_KEYS_DIR`，默认 `/workspace/calendar-diy-android-keys/keystore.properties`），**不要提交**。
- 安装：把 APK 发到手机，允许「安装未知应用」后点开安装。
