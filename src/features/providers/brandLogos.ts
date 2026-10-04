import claudeLogo from '@/assets/icons/claude.svg';
import codexLogo from '@/assets/icons/codex.svg';
import metaLogo from '@/assets/icons/meta.svg';
import devinLightLogo from '@/assets/icons/devin.svg';
import devinDarkLogo from '@/assets/icons/devin-dark.svg';
import geminiLogo from '@/assets/icons/gemini.svg';
import openaiLightLogo from '@/assets/icons/openai-light.svg';
import openaiDarkLogo from '@/assets/icons/openai-dark.svg';
import vertexLogo from '@/assets/icons/vertex.svg';
import apikeyFunLogo from '@/assets/icons/apikey-fun.png';
import fennoAILogo from '@/assets/icons/fenno-ai.png';
import qiniuCloudLogo from '@/assets/icons/qiniu-cloud.png';
import xaiLightLogo from '@/assets/icons/grok.svg';
import xaiDarkLogo from '@/assets/icons/grok-dark.svg';
import kimiLightLogo from '@/assets/icons/kimi-light.svg';
import kimiDarkLogo from '@/assets/icons/kimi-dark.svg';
import lmuAILogo from '@/assets/icons/lmu-ai.png';
import infistarLogo from '@/assets/icons/infistar.png';
import imageProviderLogo from '@/assets/icons/image-provider.svg';
import videoProviderLogo from '@/assets/icons/video-provider.svg';
import audioProviderLogo from '@/assets/icons/audio-provider.svg';
import type { ProviderBrand } from './types';

export interface ProviderBrandLogo {
  src: string;
  darkSrc?: string;
  transparent?: boolean;
  themeSurface?: boolean;
  invertOnDark?: boolean;
}

export type ProviderBrandLogoKey = ProviderBrand | 'devin';

export const PROVIDER_LOGOS: Record<ProviderBrandLogoKey, ProviderBrandLogo> = {
  gemini: { src: geminiLogo },
  interactions: { src: geminiLogo },
  claude: { src: claudeLogo },
  codex: { src: codexLogo },
  meta: { src: metaLogo, transparent: true },
  devin: { src: devinLightLogo, darkSrc: devinDarkLogo, transparent: true },
  xai: { src: xaiLightLogo, darkSrc: xaiDarkLogo, transparent: true },
  vertex: { src: vertexLogo },
  openaiCompatibility: { src: openaiLightLogo, darkSrc: openaiDarkLogo, transparent: true },
  apikeyFun: { src: apikeyFunLogo },
  fennoAI: { src: fennoAILogo, transparent: true },
  qiniuCloud: { src: qiniuCloudLogo, transparent: true },
  image: { src: imageProviderLogo },
  video: { src: videoProviderLogo },
  audio: { src: audioProviderLogo },
  lmuAI: { src: lmuAILogo, transparent: true },
  infistar: { src: infistarLogo, transparent: true },
  kimi: {
    src: kimiDarkLogo,
    darkSrc: kimiLightLogo,
    transparent: true,
    themeSurface: true,
  },
};
