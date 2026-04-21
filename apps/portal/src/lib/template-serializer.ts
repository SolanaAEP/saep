import type {
  TemplateSummary,
  TemplateForkSummary,
  TemplateRentalSummary,
  TemplateRegistryConfigSummary,
} from '@saep/sdk';

function hexFromBytes(b: Uint8Array): string {
  return Array.from(b).map((x) => x.toString(16).padStart(2, '0')).join('');
}

export interface SerializedTemplate {
  address: string;
  templateId: string;
  author: string;
  configHash: string;
  configUri: string;
  capabilityMask: string;
  royaltyBps: number;
  parentTemplate: string | null;
  lineageDepth: number;
  forkCount: number;
  rentCount: number;
  totalRevenue: string;
  rentPricePerSec: string;
  minRentDuration: number;
  maxRentDuration: number;
  status: TemplateSummary['status'];
  createdAt: number;
  updatedAt: number;
}

export interface SerializedTemplateFork {
  address: string;
  childAgentDid: string;
  parentTemplate: string;
  forker: string;
  royaltyBpsSnapshot: number;
  forkedAt: number;
}

export interface SerializedTemplateRental {
  address: string;
  template: string;
  renter: string;
  startTime: number;
  endTime: number;
  prepaidAmount: string;
  dripRatePerSec: string;
  claimedAuthor: string;
  claimedPlatform: string;
  status: TemplateRentalSummary['status'];
}

export interface SerializedTemplateRegistryConfig {
  address: string;
  authority: string;
  pendingAuthority: string | null;
  agentRegistry: string;
  treasuryStandard: string;
  feeCollector: string;
  royaltyCapBps: number;
  platformFeeBps: number;
  rentEscrowMint: string;
  paused: boolean;
}

export function serializeTemplate(template: TemplateSummary): SerializedTemplate {
  return {
    address: template.address.toBase58(),
    templateId: hexFromBytes(template.templateId),
    author: template.author.toBase58(),
    configHash: hexFromBytes(template.configHash),
    configUri: template.configUri,
    capabilityMask: template.capabilityMask.toString(),
    royaltyBps: template.royaltyBps,
    parentTemplate: template.parentTemplate?.toBase58() ?? null,
    lineageDepth: template.lineageDepth,
    forkCount: template.forkCount,
    rentCount: template.rentCount,
    totalRevenue: template.totalRevenue.toString(),
    rentPricePerSec: template.rentPricePerSec.toString(),
    minRentDuration: template.minRentDuration,
    maxRentDuration: template.maxRentDuration,
    status: template.status,
    createdAt: template.createdAt,
    updatedAt: template.updatedAt,
  };
}

export function serializeTemplateFork(fork: TemplateForkSummary): SerializedTemplateFork {
  return {
    address: fork.address.toBase58(),
    childAgentDid: hexFromBytes(fork.childAgentDid),
    parentTemplate: fork.parentTemplate.toBase58(),
    forker: fork.forker.toBase58(),
    royaltyBpsSnapshot: fork.royaltyBpsSnapshot,
    forkedAt: fork.forkedAt,
  };
}

export function serializeTemplateRental(rental: TemplateRentalSummary): SerializedTemplateRental {
  return {
    address: rental.address.toBase58(),
    template: rental.template.toBase58(),
    renter: rental.renter.toBase58(),
    startTime: rental.startTime,
    endTime: rental.endTime,
    prepaidAmount: rental.prepaidAmount.toString(),
    dripRatePerSec: rental.dripRatePerSec.toString(),
    claimedAuthor: rental.claimedAuthor.toString(),
    claimedPlatform: rental.claimedPlatform.toString(),
    status: rental.status,
  };
}

export function serializeTemplateRegistryConfig(
  config: TemplateRegistryConfigSummary,
): SerializedTemplateRegistryConfig {
  return {
    address: config.address.toBase58(),
    authority: config.authority.toBase58(),
    pendingAuthority: config.pendingAuthority?.toBase58() ?? null,
    agentRegistry: config.agentRegistry.toBase58(),
    treasuryStandard: config.treasuryStandard.toBase58(),
    feeCollector: config.feeCollector.toBase58(),
    royaltyCapBps: config.royaltyCapBps,
    platformFeeBps: config.platformFeeBps,
    rentEscrowMint: config.rentEscrowMint.toBase58(),
    paused: config.paused,
  };
}
