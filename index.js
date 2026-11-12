/**
 * dsh-weread-studio — host half.
 *
 * Owns the WeRead service (cloud shelf, progress, highlights/notes via the
 * Skills gateway, plus a local EPUB/TXT library), the agent tools, and the
 * Fetch route the left-sidebar panel calls. Tools and the panel share one
 * service instance.
 */

import Schema from '@deepseek-ai/schemastery'
import { createRpcRoute } from './lib/rpc.js'
import { WereadService } from './lib/service.js'
import { registerTools } from './lib/tools.js'

export const name = 'weread-studio'

export const inject = ['tools']

export const Config = Schema.object({
  cookie: Schema.string().default('').description('weread.qq.com Cookie header; leave empty to use QR login or demo mode'),
  apiKey: Schema.string().default('').description('WeRead skills API key (wrk-...); enables highlights, notes and reading stats'),
  syncProgress: Schema.boolean().default(false).description('Write reading progress and time back to WeRead'),
})

/**
 * Mount the plugin.
 * @param ctx - host plugin context.
 * @param config - the bundle row's config values.
 */
export function apply(ctx, config = {}) {
  const service = new WereadService({ ctx, config })
  registerTools(ctx, service)

  ctx.inject(['connection'], (scope) => {
    try {
      scope.connection.fetch.register(createRpcRoute(service))
    } catch (error) {
      ctx.logger?.warn('[weread-studio] 面板通道注册失败，Agent 工具仍可用：%s', error?.message ?? String(error))
    }
  })

  ctx.logger?.info('[weread-studio] ready (data=%s)', service.config.dataDir)
}
