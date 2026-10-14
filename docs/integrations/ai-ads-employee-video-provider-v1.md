# AI 广告员工 × 视频工厂接入契约 V1

状态：`CONTRACT_READY_FOR_STAGING`（服务端租户隔离、幂等、签名上传下载、反馈、版本与 checksum 契约已具备；广告员工侧编排器和真实模型额度尚未完成联调，不能直接宣布 Production 可用）

## 目标

把视频工厂作为广告员工的一个外部创意生产 Provider，而不是把两个产品的页面、数据库或员工口令直接合并。

广告员工继续负责客户身份、租户与项目权限、业务事实、素材权利、创意版本、审批、Meta 对象映射和结果学习。视频工厂只负责：

- 真实素材混剪（`remix`）；
- AI 画面与真实素材组合（`ai_hybrid`）；
- 广告海报（`image_poster`，广告员工已有原生图片链路时优先复用原链路）；
- 配音、字幕、BGM、CTA、版本优化和最终文件输出。

## 交互形态：统一聊天窗口中的 AI 视频员工

视频能力不以独立后台页面作为客户主要入口。它在广告员工的统一聊天窗口中注册为一个可被编排器调度的角色：

```text
客户 / 内部员工
  → 广告员工统一对话编排器
  → AI 视频员工（role: ai_video_employee）
  → CreativeVideoProvider
  → 视频任务、进度、版本和成片
  → 回到同一聊天窗口
```

AI 视频员工负责理解视频需求、检查缺失信息、提出最少必要问题、生成结构化命令、解释进度、比较版本和接收修改意见。它不能直接接触 Provider 密钥，也不能用自由文本绕过确定性命令、项目权限和审批。

建议对话意图：

- `CREATE_VIDEO`：新建混剪或 AI＋真实素材视频；
- `REVISE_VIDEO`：根据上一版和员工反馈生成下一版；
- `GET_VIDEO_STATUS`：查询任务进度和失败原因；
- `COMPARE_VIDEO_VERSIONS`：比较多个成片版本；
- `ACCEPT_VIDEO`：确认一个版本进入 CreativeVersion 与审批链路。

每次工具调用必须带由服务端生成的 `tenantId`、`projectId`、`conversationSessionId`、`correlationId` 和 `idempotencyKey`。这些字段不能由模型从用户文字中自由填写。

角色返回统一事件：`STARTED`、`PROGRESS`、`NEEDS_INPUT`、`COMPLETED`、`FAILED`、`APPROVAL_REQUIRED`。聊天窗口负责展示；视频 Provider 只返回结构化状态，不直接生成界面文案或执行 Meta 操作。

## 每个客户独立资料库

视频员工的检索、记忆、素材和结果以 `tenantId + projectId` 为强制命名空间。不同客户、同一客户的不同项目，也不能默认共用原始资料。

每个项目资料库至少分为：

1. 已确认业务事实：项目、服务、市场、语言、价格、优惠、CTA、禁止承诺；
2. 品牌资料：Logo、颜色、字体、语气、人物与视觉限制；
3. 客户素材：真实视频、图片、案例、授权范围、checksum 与来源；
4. 视频经验：已接受脚本、Hook、镜头、配音、字幕和节奏偏好；
5. 版本与反馈：任务、成片、修改意见、拒绝原因和最终接受版本；
6. 结果信息：对应 Meta CreativeVersion、平台表现和客户确认的业务结果。

资料检索必须由已验证的会话上下文注入 `tenantId/projectId` 过滤条件；不得让模型通过提示词选择任意客户资料库。原始客户素材、文案、联系人、案例、反馈和成片禁止跨租户检索或训练。未来需要跨客户学习时，只能使用客户同意、去标识、达到最小样本量并保留来源与置信度的聚合模式。

对话历史和长期项目记忆分开：聊天消息属于会话；可复用规则必须经过确认后写入该项目资料库，并记录来源消息、操作者和时间，不能把每句聊天自动当成长期事实。

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

广告员工服务端使用 `/api/a3-video-provider` 的 `provider_*` 对应动作。`GET /api/a3-video-provider` 返回非敏感的契约版本、工作流、动作清单及配置就绪状态，便于部署前健康检查；真实令牌仍只允许服务端保存。

任务输出最多 3 个版本，最终视频为 `video/mp4`；任务是异步执行，当前消费者应轮询 `status`，不得把 HTTP 请求保持到渲染结束。

## 广告员工侧接入位置

接入广告员工现有链路：

`Business Truth → Evidence → Creative Hypothesis → Source Asset → Video Job → CreativeVersion → Approval → Meta Mapping`

建议最小新增边界：

1. `CreativeVideoProvider` application port；
2. 服务端 `VideoAgentHttpProvider` adapter；
3. `/api/internal/creative/video/*` 同源路由；
4. 在现有 conversation contract 与 guarded command bridge 中注册 `ai_video_employee` 角色和视频意图；
5. 同一聊天窗口展示任务进度、成片、版本比较、修改和接受动作；工作结果页只作为可选的持久结果入口；
6. 已验收 MP4 作为创意版本产物保存，不能绕过现有客户确认和 Meta PAUSED 创建门禁。

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

## 正式接入准备度（2026-10-14）

已在视频员工侧完成：

- 外部 `tenant_id + project_id` 唯一映射与任务强制作用域；
- `idempotency_key` 去重、`conversation_session_id`、`correlation_id` 传递；
- 按作用域签发上传、提交、状态、下载、反馈、修订和接受动作；
- 结果 SHA-256 绑定，未完成或无 checksum 的版本禁止接受；
- V3 广告员工专用服务端网关、Bearer 认证、请求字段前置校验与能力发现接口；
- Provider 故障与广告员工原图片/Meta 链路隔离。

仍需在广告员工仓库及目标环境完成：

- 注册 `ai_video_employee` 角色、五类视频意图与 guarded command bridge；
- 配置广告员工服务端 Provider URL/令牌，Staging 单租户完成真实联调；
- 将已接受 MP4 写入广告员工 `CreativeVersion` lineage 和审批快照；
- 补取消/超时的产品交互，并完成 390px、刷新恢复和跨租户攻击验收；
- 为 GPT Image / Runway / Seedance 配置可用付费额度和密钥，完成小额真实质量样本。

## 正式接入前完整门禁

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
11. 对话会话、角色工具调用和项目资料检索全部绑定服务端解析的 `tenantId/projectId`；
12. 为“聊天内容写入长期项目记忆”增加显式确认、来源和审计，不自动污染客户资料库。

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
- 在同一聊天窗口中可以点名或由编排器选择“AI 视频员工”，无需进入另一套后台；
- 视频角色只接收服务端绑定的客户资料库，不能读取或猜测其他客户资料；
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
