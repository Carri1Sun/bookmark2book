# Tabbit 文集

将收藏夹整理为一本文集。每篇文章用本子封面展示标题，并附 AI 介绍与原文链接。保留中央开书、骨架缩略图展开、顶部标题固定的阅读效果，支持导出独立 HTML。

## 安装浏览器插件

支持 Chrome / Edge 120 及以上版本。插件可独立使用，不需要 Node.js、本地服务或 `.env`。

1. 解压 `dist/bookmark-press-extension.zip`，或直接使用项目中的 `dist/extension`。
2. 打开 `chrome://extensions` 或 `edge://extensions`，开启「开发者模式」。
3. 点击「加载已解压的扩展程序」，选择包含 `manifest.json` 的文件夹。
4. 点击 Tabbit 文集插件图标，进入首页。
5. 点击齿轮「设置」，填写 API Key，测试连接并保存。默认使用 DeepSeek 的 `deepseek-flash`；可展开「API 地址与模型」配置支持 Chat Completions JSON 输出的兼容服务。基础地址不要附加 `/chat/completions`。

构建命令：

```bash
pnpm install
pnpm build
```

构建同时生成扩展目录与 ZIP；安装包不包含开发者的 API Key、`.env` 或已有私人文集。更新已加载的扩展时，在扩展管理页点击重新加载即可。

## 使用

1. 在首页点击「添加」，插件通过浏览器的 `chrome.bookmarks.getTree()` 直接显示收藏夹与书签，无需上传文件。
2. 勾选一个收藏夹作为文集根目录，其中的文章与子文件夹会整体收录为树状文集；单篇文章仅展示、不可单独勾选。支持搜索与重复链接去重。
3. 设置文集名称、封面颜色和可选的编辑方向。选择文件夹时带入名称，留空则由 AI 拟定。
4. 点击「生成介绍」。浏览器按需请求读取所选网站的权限，仅将所选内容发送给配置的 API 服务。
5. 确认或修改文章标题、介绍与排列顺序，点击「保存文集」，文集会出现在首页。
6. 点击文集封面开始阅读，也可以导出 HTML。文件内嵌样式、禁止脚本与外部资源，可离线阅读介绍；原文链接仍需联网。

扩展管理页的「扩展程序选项」也能进入设置。密钥输入框不回填明文；留空保存会保留已有密钥，更换 API 服务域名时需重新填写密钥。可以随时删除保存的密钥。

## 本地保存与后台任务

- 密钥与 API 配置保存于 `chrome.storage.local`，限制为扩展可信上下文访问，不使用浏览器云同步。
- 文集与生成进度存于扩展自身的 IndexedDB，与普通网页预览的数据独立。
- 生成通过扩展的 offscreen 页面读取 HTML、提取正文并调用模型。关闭首页后保持浏览器运行，任务可继续；返回「添加」即可恢复待确认草稿。
- 浏览器重启中断的任务会显示失败，并保留所选书签供重试；已保存文集不受影响。
- 保存文集与完成任务在同一数据库事务中提交，避免重复点击产生重复文集。
- 卸载扩展会移除其本地数据；需要保留的文集请先导出 HTML。

## 权限与边界

- `bookmarks`：读取收藏夹树。代码不会修改、移动或删除原始书签。
- `storage`：保存用户的 API 配置。
- `offscreen`：后台解析文章 HTML 和完成整理。
- 默认允许请求 `https://api.deepseek.com`；其他 API 地址与所选文章网站在用户操作时按需请求访问权限。
- 不注入内容脚本，读取文章时不携带登录凭据。不执行所抓取页面中的脚本，不按网页内的指令访问其他网址。
- 不能可靠读取登录后、付费或主要由脚本渲染的正文；暂不解析 PDF、视频。读取失败仍保留所选书签，并标示介绍仅依据标题或简介推测。
- 每本文集最多 500 个不同链接，同时最多两个生成任务。正文每篇最多采集 14,000 字符，每批五篇交给模型生成短介绍。
- 普通网页不能读取浏览器书签，必须从安装后的插件进入。参见 [Chrome Bookmarks API](https://developer.chrome.com/docs/extensions/reference/api/bookmarks) 与 [扩展网站权限](https://developer.chrome.com/docs/extensions/reference/api/permissions)。

三个内置文集为原创排版示例。选择「示例素材」会真实分析 Kaiyi's Notes 的三篇公开文章，正常计入 API 用量。

## 网页开发预览

```bash
pnpm dev
```

打开 `http://127.0.0.1:5173`，预览后端监听 `127.0.0.1:8787`。普通网页预览可使用粘贴链接与示例素材，也提供设置与插件下载入口。

网页模式优先使用 `.data/api-settings.json` 中保存的配置；尚未保存时兼容项目 `.env`：

```dotenv
DEEPSEEK_API_KEY=你的密钥
DEEPSEEK_MODEL=deepseek-flash
DEEPSEEK_BASE_URL=https://api.deepseek.com
PORT=8787
```

网页模式的文集与任务保存在 `.data/books/`、`.data/jobs/`；API 配置文件权限为 `0600`。这些开发数据不会装入扩展。构建后可通过 `pnpm start` 在 `http://127.0.0.1:8787` 使用网页版本。

## 实现与验证

```text
src/extension/       插件配置、消息、IndexedDB、后台任务与网页提取
src/components/      首页、收藏选择、API 设置与文集阅读器
shared/              网页与插件共用的模型调用、分析流程与校验
server/              普通网页开发预览的本机 API
scripts/             扩展构建、打包与真实 API 冒烟测试
tests/               密钥处理、来源校验、生成取消、持久化与安全渲染
```

```bash
pnpm typecheck
pnpm test
pnpm build
```

以下可选测试使用开发环境的密钥并消耗少量真实 API 用量：

```bash
pnpm smoke             # 测试本地服务，保存一本文集
pnpm smoke:extension   # 独立测试扩展任务引擎，无需启动本地服务
```

扩展引擎测试在 Node 中用 DOM 与 IndexedDB 测试实现验证业务流程；浏览器网页测试验证选择、设置和阅读界面。Chrome 原生安装、权限弹窗、service worker 与 offscreen 的协作还需要加载扩展进行验证。
