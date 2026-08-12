import type { RequestLogItem } from '@/services/api';

type ProviderLogFields = Pick<
  RequestLogItem,
  'provider' | 'channel_model' | 'model' | 'upstream_model'
>;

export const requestLogProviderLabel = (item: Partial<ProviderLogFields>): string => {
  const provider = String(item.provider ?? '').trim();
  if (provider) return provider;
  const channelModel = String(item.channel_model ?? '').trim();
  const separator = channelModel.indexOf(' / ');
  if (separator < 0) return '—';
  return channelModel.slice(0, separator).trim() || '—';
};

export const requestLogModelLabel = (item: Partial<ProviderLogFields>): string => {
  const requestedModel = String(item.model ?? '').trim();
  if (requestedModel) return requestedModel;
  const upstreamModel = String(item.upstream_model ?? '').trim();
  if (upstreamModel) return upstreamModel;
  const channelModel = String(item.channel_model ?? '').trim();
  const provider = requestLogProviderLabel(item);
  if (!channelModel || channelModel === provider) return '无需模型';
  const separator = channelModel.indexOf(' / ');
  return separator >= 0 ? channelModel.slice(separator + 3).trim() || '无需模型' : channelModel;
};
