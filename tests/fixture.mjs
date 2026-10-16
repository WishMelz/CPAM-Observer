import { createHash } from 'node:crypto';

export const sentinel = 'TEST_TOKEN_NEVER_EXPOSE_762154';
export const viewerKey = 'AbCdEf';
export const upstreamKey = 'test-upstream-administrator-key';
const now = Date.now();
const digest = (value) => createHash('sha256').update(value).digest('hex');
const keyHash = digest(sentinel);
const providers = ['codex', 'claude', 'gemini'];
const models = ['gpt-5.4', 'claude-sonnet-4-6', 'gemini-3.1-pro'];
const files = Array.from({ length: 15 }, (_, index) => ({
  name: `account-${index + 1}.json`, id: `account-${index + 1}.json`, auth_index: String(index + 1),
  provider: providers[index % 3], type: providers[index % 3], email: `viewer-${index + 1}@example.test`,
  status: 'ready', disabled: false, priority: 0, plan_type: 'team', updated_at: new Date(now).toISOString(),
  id_token: { chatgpt_account_id: `workspace-${index + 1}`, chatgpt_plan_type: 'team', chatgpt_subscription_active_until: now + 86400000 },
  access_token: sentinel,
}));
const events = Array.from({ length: 60 }, (_, index) => ({
  request_id: `request-${index}`, event_hash: `event-${index}`, timestamp_ms: now - index * 60000,
  model: models[index % 3], auth_provider_snapshot: providers[index % 3], auth_file_snapshot: files[index % 3].name,
  account_snapshot: files[index % 3].email, auth_index: String(index % 3 + 1), api_key_hash: keyHash,
  source: sentinel, source_hash: digest(sentinel), endpoint: '/v1/responses', method: 'POST', path: '/v1/responses',
  input_tokens: 1200, output_tokens: 300, cached_tokens: 400, cache_read_tokens: 400, cache_creation_tokens: 0,
  reasoning_tokens: 50, total_tokens: 1500, latency_ms: 800, ttft_ms: 100, failed: index % 7 === 0,
  fail_status_code: index % 7 === 0 ? 429 : null, fail_summary: index % 7 === 0 ? 'Rate limit exceeded' : '',
  stream: true, header_trace_id: `trace-${index}`,
}));
const aggregate = (rows) => ({ calls: rows.length, success_calls: rows.filter((entry) => !entry.failed).length,
  failure_calls: rows.filter((entry) => entry.failed).length, success_rate: rows.length ? rows.filter((entry) => !entry.failed).length / rows.length : 0,
  input_tokens: rows.length * 1200, output_tokens: rows.length * 300, cached_tokens: rows.length * 400,
  cache_read_tokens: rows.length * 400, cache_creation_tokens: 0, total_tokens: rows.length * 1500,
  cost: rows.length * .01, average_latency_ms: 800, last_seen_ms: now });

const inspectionRun = {
  id: 1, triggerType: 'manual', status: 'completed', startedAtMs: now - 60000,
  finishedAtMs: now - 30000, createdAtMs: now - 60000, updatedAtMs: now - 30000,
  totalFiles: 4, probeSetCount: 4, sampledCount: 4, disabledCount: 1, enabledCount: 3,
  deleteCount: 1, disableCount: 1, enableCount: 1, reauthCount: 1, keepCount: 0,
};
const inspectionResults = ['delete', 'disable', 'enable', 'reauth'].map((action, index) => ({
  id: index + 1, runId: 1, accountKey: `fixture-account-${index + 1}`,
  fileName: files[index].name, displayAccount: files[index].email, authIndex: files[index].auth_index,
  provider: 'codex', disabled: action === 'enable', state: 'ready', action,
  actionReason: 'Saved inspection result', actionStatus: 'pending', isQuota: false,
  statusCode: action === 'reauth' ? 401 : 200, createdAtMs: now - 30000,
}));

export function fixture(pathname, body = {}, search = new URLSearchParams()) {
  if (pathname === '/usage-service/info') return { service: 'cpa-manager-plus', configured: true, adminReady: true };
  if (pathname === '/usage-service/config') return { config: {
    cpaConnection: { cpaBaseUrl: 'http://fixture.invalid', managementKeyConfigured: true },
    collector: { enabled: true, collectorMode: 'redis', queue: 'usage', popSide: 'left', batchSize: 100, pollIntervalMs: 1000, queryLimit: 1000 },
    externalUsageService: { enabled: false, serviceBase: '' }, codexInspection: { enabled: false, schedule: { enabled: false }, targetTypes: ['codex'] },
  } };
  if (pathname === '/status') return { service: 'cpa-manager-plus', events: 60, collector: { collector: 'running' }, databaseMaintenance: { required: false, reasons: [] } };
  if (pathname === '/usage-service/account-processing-policy') return Object.fromEntries(['codexQuotaCooldown', 'authIssueQueue', 'authIssueAutoDisable'].map((name) => [name, { enabled: false, configured: true }]));
  if (pathname.endsWith('/config')) return { 'usage-statistics-enabled': true, 'api-keys': [sentinel] };
  if (pathname.endsWith('/auth-files')) return { files };
  if (pathname.endsWith('/auth-files/download')) return files.find((entry) => entry.name === search.get('name')) || files[0];
  if (pathname.endsWith('/auth-files/models')) return { models: models.map((id) => ({ id, object: 'model', owned_by: 'fixture' })) };
  if (pathname.includes('/model-definitions/')) return { models: models.map((id) => ({ id, object: 'model', owned_by: 'fixture' })) };
  if (pathname.endsWith('/api-keys')) return { 'api-keys': [sentinel] };
  if (pathname.endsWith('/api-key-aliases')) return { aliases: [{ apiKeyHash: keyHash, alias: 'Test Key' }] };
  if (pathname.endsWith('/model-prices')) return { prices: Object.fromEntries(models.map((model) => [model, { prompt: 2, completion: 5, cache: .2 }])) };
  if (pathname.endsWith('/model-prices/runtime-models')) return { models: [], missingModels: [], missingCount: 0 };
  if (pathname.endsWith('/oauth-excluded-models')) return { 'oauth-excluded-models': { codex: ['disabled-model'] } };
  if (pathname.endsWith('/oauth-model-alias')) return { 'oauth-model-alias': { codex: [{ name: 'gpt-5.4', alias: 'viewer-model', fork: true }] } };
  if (pathname.endsWith('/codex-inspection/runs')) return { items: [inspectionRun, { ...inspectionRun, id: 2, status: 'running', active: true, cancellable: true, finishedAtMs: undefined }] };
  if (/\/codex-inspection\/runs\/[12]$/.test(pathname)) return {
    run: pathname.endsWith('/2') ? { ...inspectionRun, id: 2, status: 'running', active: true, cancellable: true, finishedAtMs: undefined } : inspectionRun,
    results: inspectionResults,
    logs: [{ id: 1, runId: 1, level: 'info', message: 'Saved inspection log', createdAtMs: now - 30000 }],
  };
  if (pathname.endsWith('/header-snapshots') || pathname.endsWith('/quota-cooldowns') || pathname.endsWith('/account-action-candidates')) return { items: [], generated_at_ms: now };
  if (pathname.endsWith('/account-history')) {
    if (body.catch_up !== false) throw new Error('History write attempted');
    return { generated_at_ms: now, checkpoint: { pending: false, processed: 0, last_event_id: 60, latest_id: 60 }, items: body.accounts.map((account) => ({
      row_key: account.row_key, account_key: account.row_key, matched: true, total_requests: 60, success_calls: 52, failure_calls: 8,
      total_tokens: 90000, total_cost: .6, success_rate: 52 / 60, first_seen_ms: now - 3600000, last_seen_ms: now,
      sync_status: 'ready', recent_requests: events.slice(0, 10), latest_request: events[0],
    })) };
  }
  if (pathname.endsWith('/quota-snapshots/query')) {
    if (body.accounts.length > 40 || body.accounts.some((entry) => 'row_key' in entry.account)) throw new Error('Invalid snapshot identity batch');
    return { generated_at_ms: now, items: body.accounts.map((account, index) => ({ row_key: account.row_key, provider: account.provider, windows: [{
      provider_window_id: account.provider === 'codex' ? 'primary' : 'five_hour', window_kind: 'five_hour', window_mode: 'fixed',
      model_scope_kind: account.provider === 'codex' ? 'family' : 'all', model_scope_key: account.provider === 'codex' ? 'codex_main' : undefined,
      source: 'api_query', observed_at_ms: now, boundary_accuracy: 'exact', cycle_start_ms: now - 3600000, cycle_end_ms: now + 14400000,
      duration_seconds: 18000, used_percent: index === 2 ? undefined : 25, remaining_percent: index === 2 ? undefined : 75,
      stale: index === 1, availability: 'active',
    }] })) };
  }
  if (pathname.endsWith('/account-window-usage')) return { items: body.windows.map((window) => ({ ...window, matched: true, total_requests: 20, total_tokens: 30000, total_cost: .2 })) };
  if (pathname.endsWith('/monitoring/analytics')) {
    const filters = body.filters || {};
    const matching = events.filter((entry) => (!filters.models?.length || filters.models.includes(entry.model)) && (!filters.auth_indices?.length || filters.auth_indices.includes(entry.auth_index)) && (!filters.api_key_hashes?.length || filters.api_key_hashes.includes(entry.api_key_hash)) && (!filters.failed_only || entry.failed) && (filters.include_failed !== false || !entry.failed));
    const accounts = files.slice(0, 3).map((file) => {
      const rows = matching.filter((entry) => entry.auth_index === file.auth_index);
      return { id: `credential:${file.auth_index}:${Buffer.from(sentinel).toString('hex')}`, auth_index: file.auth_index, auth_indices: [file.auth_index], auth_file_snapshot: file.name, account_snapshot: file.email, auth_provider_snapshot: file.provider, source: sentinel, source_hash: digest(sentinel), ...aggregate(rows), models: [{ model: models[Number(file.auth_index) - 1], ...aggregate(rows) }] };
    });
    const keys = [{ id: sentinel, api_key_hash: keyHash, ...aggregate(matching), contexts: accounts }];
    const timeline = Array.from({ length: 12 }, (_, index) => ({ bucket_ms: now - (11 - index) * 3600000, bucket_end_ms: now - (10 - index) * 3600000,
      label: `${index}:00`, calls: 5, success: 4, failure: 1, tokens: 7500, total_tokens: 7500, input_tokens: 6000, output_tokens: 1500, cached_tokens: 2000, cost: .05, average_latency_ms: 800, success_rate: .8 }));
    const stats = aggregate(matching);
    const channels = accounts.map((account) => ({ ...account, success: account.success_calls, failure: account.failure_calls, tokens: account.total_tokens }));
    const modelStats = models.map((model) => ({ model, ...aggregate(matching.filter((entry) => entry.model === model)) }));
    return { generated_at_ms: now, granularity: body.include?.granularity || 'hour',
      summary: { ...stats, total_calls: stats.calls, total_cost: stats.cost, rpm_30m: 2, tpm_30m: 3000 },
      summary_comparison: { total_calls: 40, total_tokens: 60000, total_cost: .4, success_rate: .9 },
      timeline, credential_timeline: accounts.filter((entry) => !filters.credential_ids?.length || filters.credential_ids.includes(entry.id)).flatMap((entry) => timeline.map((point) => ({ ...entry, ...point }))),
      api_key_timeline: timeline.map((entry) => ({ ...entry, api_key_hash: keyHash })),
      model_stats: modelStats, account_stats: accounts, credential_stats: accounts, api_key_stats: keys, channel_share: channels,
      heatmap: Array.from({ length: 168 }, (_, index) => ({ weekday: Math.floor(index / 24), hour: index % 24, calls: index % 10, tokens: index * 100, cost: index * .01, success: index % 9, failure: 1, model_contributors: [], api_key_contributors: [], provider_contributors: [] })),
      anomaly_points: [], hourly_distribution: [], model_share: [], failure_sources: [], task_buckets: [], recent_failures: matching.filter((entry) => entry.failed),
      filter_options: { models, model_stats: modelStats, providers, auth_files: files.map((entry) => entry.name), accounts: files.map((entry) => entry.email), api_key_hashes: [keyHash], account_stats: accounts, api_key_stats: keys, channel_share: channels },
      events: { items: matching.slice(0, 50), total_count: matching.length, has_more: false },
      drilldown_preview: { items: matching.slice(0, 12), total_count: matching.length, has_more: false }, coverage: { mode: 'raw', raw_complete: true },
    };
  }
  if (/-api-key$/.test(pathname) || pathname.endsWith('/openai-compatibility')) return { [pathname.split('/').at(-1)]: [] };
  if (pathname.endsWith('/usage')) return { usage: { total_requests: 60, total_tokens: 90000, apis: {} } };
  throw new Error(`Unexpected fixture endpoint: ${pathname}`);
}