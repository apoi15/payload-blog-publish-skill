# payload-blog-publish-skill（中文说明）

一个给 AI 编程助手（Claude Code、Codex 等读取 `SKILL.md` 的 agent）用的博客发布 skill，外加四个小脚本：在 **Next.js + Payload CMS 3** 网站上调研、撰写并发布多语言博客文章。不用在后台点表单，也不让 agent 自己临场写数据库。

它来自一个每篇文章都发三种语言的线上 B2B 网站，公司相关内容已全部去掉，编辑资料只保留模板，需要你自己填。

详细原理见 [README.md](README.md)，这里是要点。

## 核心原理

1. **agent 只写文件，脚本才写 CMS。** agent 产出的是 `output/blog-drafts/<slug>/` 下的 Markdown，可 diff、可人工审、可重跑；写文章只能走 `blog:publish` 这一条确定性路径。
2. **严格的 Markdown 子集，一一对应 Lexical。** 标题、段落、列表、图片、表格、引用、提示框、CTA、视频各对应一个 Lexical 节点或 Payload block；H1、H4、代码块、HTML、裸链接、嵌套列表等一律带行号报错，不做近似转换。
3. **先 dry-run，输出 JSON。** 不带 `--apply` 时只校验并输出 create/update 判断、各语言词数、FAQ 数、链接数、meta 长度。还会检查：meta 长度与禁用词、每条站内链接在线上必须返回 200（重定向也算错）、链接不能跨语言、各语言 slug 冲突、图片 alt 与命名。
4. **一篇文章 = 一个文档，所有语言写进同一个 id**，hreflang 才不会断。
5. **媒体按文件名复用**，重跑不重复上传；新文件名必须以文章 slug 开头；alt 按语言写入且关闭回退。
6. **写后回读校验**：每种语言关掉回退读回来，富文本按“语义”比较（节点类型、标题级别、文本格式、链接、block 字段），`all locales match` 才算成功。
7. **改旧文章先无损导出**：`blog:export` 把 Lexical 转回 Markdown 并做往返验证，不能无损还原就禁止用这份草稿覆盖正文，避免“改个错字”把后台加的格式抹掉。
8. **生产库闸门不靠 agent 记性**：连接前按 `DATABASE_URL` 的主机判断，命中 `PRODUCTION_DB_HOSTS` 时必须当条命令带 `ALLOW_PRODUCTION_DB=true`；skill 另规定只有用户本次明确要求才写生产。
9. **CLI 写入后的缓存清理**：Payload hook 里的 `revalidatePath` 在 Next.js 之外会抛错，所以提供一个带密钥、限定范围的 `/api/revalidate` 接口，发布脚本写完生产后调用它。注意 `revalidatePath` 要用含路由组的路由文件路径（如 `/(frontend)/[lang]/blog`），不是公开 URL。
10. **调研纪律**：读同意图的 Google 前三名，目标词数为平均值的 80–120%；FAQ 只用真实出现的 People Also Ask；竞品只参考意图与结构不抄内容；开头 40–70 词直接回答，方便 AI 搜索引用；先查关键词归属防蚕食；约 28 天后看 Search Console 和询盘再决定去留。
11. **配图让 agent 真的“看”**：`blog:pexels` 生成带编号的联系表图片，多模态 agent 看图选号，下载后自动裁切并输出摄影师归因。图库图不得冒充自家场景。
12. **私有知识不进公开仓库**：流程公开，`references/`（文风、可发布的数字、关键词归属、客户故事）只是模板，填好的版本放在你自己的用户级 skill 目录。

## 安装

见 [README.md 的 Setup](README.md#setup)：复制 `scripts/blog/` 到项目并改 `config.ts`，加 blocks 和 `/api/revalidate` 路由，配置环境变量，把 `skill/payload-blog-publish/` 放进 `~/.claude/skills/`，填写 `references/`。

## 许可

MIT
