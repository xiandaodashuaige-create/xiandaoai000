# AI 广告员工 × 视频工厂接入契约 V1

状态：`PARTIAL`（现有内部视频工厂可运行；完成租户隔离前不可直接开放给广告员工客户）

## 目标

把视频工厂作为广告员工的一个外部创意生产 Provider，而不是把两个产品的页面、数据库或员工口令直接合并。

广告员工继续负责客户身份、租户与项目权限、业务事实、素材权利、创意版本、审批、Meta 对象映射和结果学习。视频工厂只负责：

- 真实素材混剪（`remix`）；
- AI 画面与真实素材组合（`ai_hybrid`）；
- 广告海报（`image_poster`，广告员工已有原生图片链路时优先复用原链路）；
- 配音、字幕、BGM、CTA、版本优化和最终文件输出。

## 当前可用接口

服务入口：Supabase Edge Function `video-agent-v0`。

认证仅允许服务端使用：

```http
x-video-access: ${VIDEO_AGENT_ACCESS}
content-type: application/json
```

浏览器、客户端包、日志、Issue 和仓库均不得出现真实令牌。

现有 action：

| action | 用途 |
| --- | --- |
| `create_project` / `update_project` | 建立或更新视频项目事实 |
| `init_job` | 建立生产任务，模式为 `remix`、`ai_hybrid` 或 `image_poster` |
| `sign_upload` | 为任务签发输入素材路径 |
| `submit_job` | 提交素材并进入队列 |
| `status` | 查询进度、阶段、错误和结果 |
| `create_revision` | 基于上一版按反馈生成下一版本 |
| `record_feedback` | 记录员工修改要求和操作事件 |
| `accept_job` | 确认选中的视频版本 |
| `download_url` | 获取短时结果下载地址 |

任务输出最多 3 个版本，最终视频为 `video/mp4`；任务是异步执行，当前消费者应轮询 `status`，不得把 HTTP 请求保持到渲染结束。

## 广告员工侧接入位置

接入广告员工现有链路：

`Business Truth → Evidence → Creative Hypothesis → Source Asset → Video Job → CreativeVersion → Approval → Meta Mapping`

建议最小新增边界：

1. `CreativeVideoProvider` application port；
2. 服务端 `VideoAgentHttpProvider` adapter；
3. `/api/internal/creative/video/*` 同源路由；
4. 在客户项目工作结果页增加独立的“广告视频”卡片；
5. 已验收 MP4 作为创意版本产物保存，不能绕过现有客户确认和 Meta PAUSED 创建门禁。

浏览器只能携带广告员工自己的安全会话。广告员工服务端根据已验证的 `tenantId`、`projectId`、`actorUserId` 调用视频 Provider；不得把视频工厂员工令牌下发给浏览器。

## 请求映射

广告员工的权威数据映射到视频项目：

| 广告员工权威字段 | 视频字段 |
| --- | --- |
| 客户/项目名称 | `client_name` / `project_name` |
| 已确认业务与服务 | `business_type` / `business_summary` |
| 目标客户 | `target_audience` |
| 准确价格、优惠与事实 | `offer_facts` |
| 转化目标与 WhatsApp | `cta` |
| 市场与语言 | `default_language` 和任务 brief |
| 强制事实与合规限制 | `must_include` / `must_exclude` |
| 创意假设、证据引用 | 任务 brief 与后续 lineage |

视频工厂不能自行推断价格、联系方式、客户案例、效果承诺或跨项目素材。

## 正式接入前必须补齐

当前内部 PoC 仍使用一个服务级令牌保护全部项目，因此只能由广告员工服务端调用。正式客户接入前完成：

1. 视频项目增加外部 `tenant_id`、`project_id` 和唯一映射约束；
2. 所有项目、任务、反馈、上传路径和下载路径强制校验该映射；
3. `init_job` 增加 `idempotency_key`，重复请求返回同一任务；
4. 结果保存 MP4 SHA-256、时长、尺寸、语言、Provider、模型和估算成本；
5. 补齐可从空库重放的基础 migration（当前仓库只有后续增量 migration）；
6. 输入输出使用短时签名 URL，路径包含租户、项目和任务，拒绝任意路径签名；
7. 增加失败重试上限、超时、取消和清晰错误状态；
8. 接入广告员工现有 CreativeVersion lineage 和审批快照；
9. 内部 feature flag 默认关闭，先在 Staging 单项目验证；
10. 完成跨租户 IDOR、重复提交、刷新恢复、过期链接及 390px/桌面浏览器验收。

## 环境变量

广告员工服务端：

```text
VIDEO_AGENT_ENABLED=false
VIDEO_AGENT_BASE_URL=https://ejspsxjeelhsevldmnhl.supabase.co/functions/v1/video-agent-v0
VIDEO_AGENT_ACCESS=<server-only secret>
```

不得使用 `NEXT_PUBLIC_` 前缀。Production、Staging 和本地环境分别配置，不能共享长期凭证。

## V1 验收

- 广告员工已登录用户只能看到自己项目的视频任务；
- 任务来源事实与广告员工已确认事实一致；
- 可上传客户素材、提交任务、刷新后恢复进度、查看 MP4、提出修改并生成 V2；
- 接受版本后形成带 checksum 的 CreativeVersion，仍需独立审批才能进入 Meta 创建；
- 旧员工口令和浏览器端直接调用均不能访问 Provider；
- 无跨租户素材、结果、反馈和签名路径泄漏；
- Provider 故障不影响广告员工现有图片创意与 Meta 链路。

## 非目标

- 不把视频工厂数据库搬进广告员工数据库；
- 不让视频工厂直接创建或启动 Meta 广告；
- 不在第一阶段重写视频生成模型或渲染系统；
- 不把当前内部员工页面 iframe 到客户页面；
- 不因接入视频而改变现有图片创意、审批或 PAUSED 安全门禁。
