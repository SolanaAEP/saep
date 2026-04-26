'use client';

import { useEffect, useMemo, useState } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import {
  buildTaskCompletionProveRequest,
  deriveTaskCompletionProofKey,
  groth16ProofToTaskMarketProofBytes,
  hexToBytes,
  parseTaskCompletionWitnessJson,
  useAgent,
  useCreateProofGenJob,
  useProofGenJob,
  useReleaseTaskEscrow,
  useSession,
  useSettlementReadiness,
  useSignOut,
  useSiwsSignIn,
  useSubmitTaskResult,
  useVerifyTaskResult,
  validateProofPublicInputs,
  type ProofGenJobResponse,
} from '@saep/sdk-ui';
import type { TaskDetail } from '@saep/sdk';

function hex(bytes: Uint8Array): string {
  return Array.from(bytes).map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function short(sig: string): string {
  return `${sig.slice(0, 10)}…${sig.slice(-6)}`;
}

function secondsRemaining(end: number): number {
  return Math.max(0, Math.ceil(end - Date.now() / 1000));
}

function statusTone(ok: boolean): string {
  return ok ? 'text-lime bg-lime/10 border-lime/20' : 'text-danger bg-danger/10 border-danger/20';
}

export function SettlementPanel({ task }: { task: TaskDetail }) {
  const { publicKey } = useWallet();
  const taskIdHex = hex(task.taskId);
  const didHex = hex(task.agentDid);
  const { data: agent } = useAgent(didHex);
  const { data: session } = useSession();
  const signIn = useSiwsSignIn();
  const signOut = useSignOut();
  const readiness = useSettlementReadiness();
  const submitResult = useSubmitTaskResult();
  const createProof = useCreateProofGenJob();
  const verifyTask = useVerifyTaskResult();
  const releaseTask = useReleaseTaskEscrow();

  const [resultHashText, setResultHashText] = useState('');
  const [witnessText, setWitnessText] = useState('');
  const [jobId, setJobId] = useState<string | null>(null);
  const [proofResult, setProofResult] = useState<ProofGenJobResponse | null>(null);
  const [autoProve, setAutoProve] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitSig, setSubmitSig] = useState<string | null>(null);
  const [verifySig, setVerifySig] = useState<string | null>(null);
  const [releaseSig, setReleaseSig] = useState<string | null>(null);
  const proofJob = useProofGenJob(jobId);

  const walletBase58 = publicKey?.toBase58() ?? null;
  const agentOperator = agent?.operator.toBase58() ?? null;
  const activeAgentOperator = Boolean(
    agent && agent.status === 'active' && walletBase58 && agentOperator === walletBase58,
  );
  const canSubmit = task.status === 'funded' && activeAgentOperator && readiness.data?.ready;
  const canGenerateProof = task.status === 'proofSubmitted' && readiness.data?.ready;
  const canVerify = task.status === 'proofSubmitted' && readiness.data?.ready && Boolean(proofResult?.proof);
  const releaseRemaining = secondsRemaining(task.disputeWindowEnd);
  const canRelease =
    task.status === 'verified'
    && readiness.data?.ready
    && releaseRemaining === 0
    && Boolean(agent);

  const storedKey = `saep:settlement:${taskIdHex}`;

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(storedKey);
      if (!raw) return;
      const stored = JSON.parse(raw) as {
        jobId?: string;
        proofResult?: ProofGenJobResponse;
        resultHashText?: string;
      };
      if (stored.jobId) setJobId(stored.jobId);
      if (stored.proofResult) setProofResult(stored.proofResult);
      if (stored.resultHashText) setResultHashText(stored.resultHashText);
    } catch {
      window.localStorage.removeItem(storedKey);
    }
  }, [storedKey]);

  useEffect(() => {
    const current = proofJob.data;
    if (current?.status === 'completed' && current.proof) {
      setProofResult(current);
      window.localStorage.setItem(
        storedKey,
        JSON.stringify({ jobId, proofResult: current, resultHashText }),
      );
    }
  }, [jobId, proofJob.data, resultHashText, storedKey]);

  const readinessChecks = readiness.data?.checks ?? [];
  const blockingChecks = readinessChecks.filter((check) => !check.ok);

  const normalizedResultHash = useMemo(() => {
    const trimmed = resultHashText.trim();
    if (!trimmed) return `0x${hex(task.resultHash)}`;
    return trimmed.startsWith('0x') ? trimmed : `0x${trimmed}`;
  }, [resultHashText, task.resultHash]);

  async function readWitnessFile(file: File | null) {
    if (!file) return;
    setWitnessText(await file.text());
  }

  async function generateProofFromCurrentTask() {
    setFormError(null);
    if (!session) {
      await signIn();
    }
    const witness = parseTaskCompletionWitnessJson(witnessText);
    const request = buildTaskCompletionProveRequest(task, witness);
    const publicInputErrors = validateProofPublicInputs(request.public_inputs);
    if (publicInputErrors.length > 0) throw new Error(publicInputErrors.join('; '));
    const response = await createProof.mutateAsync(request);
    if (response.status === 'completed' && response.proof) {
      setProofResult(response);
      setJobId(null);
      window.localStorage.setItem(
        storedKey,
        JSON.stringify({ proofResult: response, resultHashText: normalizedResultHash }),
      );
    } else if (response.job_id) {
      setJobId(response.job_id);
      window.localStorage.setItem(
        storedKey,
        JSON.stringify({ jobId: response.job_id, resultHashText: normalizedResultHash }),
      );
    }
  }

  useEffect(() => {
    if (!autoProve || task.status !== 'proofSubmitted' || !readiness.data?.ready) return;
    setAutoProve(false);
    void generateProofFromCurrentTask().catch((error) => {
      setFormError(error instanceof Error ? error.message : 'Proof generation failed');
    });
  }, [autoProve, readiness.data?.ready, task.status]);

  async function onSubmitResult() {
    setFormError(null);
    try {
      if (!agent) throw new Error('Assigned agent account was not found');
      if (!resultHashText.trim()) throw new Error('Result hash is required');
      const resultHash = hexToBytes(normalizedResultHash, 32);
      const proofKey = await deriveTaskCompletionProofKey({ taskId: task.taskId, resultHash });
      const result = await submitResult.mutateAsync({
        task: task.address,
        agentAccount: agent.address,
        resultHash,
        proofKey,
      });
      setSubmitSig(result.signature);
      setAutoProve(Boolean(witnessText.trim()));
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Result submission failed');
    }
  }

  async function onGenerateProof() {
    try {
      await generateProofFromCurrentTask();
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Proof generation failed');
    }
  }

  async function onVerify() {
    setFormError(null);
    try {
      if (!proofResult?.proof) throw new Error('Proof is not ready');
      const proof = groth16ProofToTaskMarketProofBytes(proofResult.proof);
      const result = await verifyTask.mutateAsync({
        task: task.address,
        proofA: proof.proofA,
        proofB: proof.proofB,
        proofC: proof.proofC,
      });
      setVerifySig(result.signature);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Verification failed');
    }
  }

  async function onRelease() {
    setFormError(null);
    try {
      if (!agent) throw new Error('Assigned agent account was not found');
      const result = await releaseTask.mutateAsync({
        task,
        agentAccount: agent.address,
        agentOperator: agent.operator,
      });
      setReleaseSig(result.signature);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Release failed');
    }
  }

  return (
    <div className="border border-ink/10 p-5 flex flex-col gap-5">
      <header className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-sm font-medium">Settlement</h2>
          <p className="mt-1 text-xs text-ink/55">
            Public-agent completion for this escrow.
          </p>
        </div>
        <span
          className={`w-fit border px-2 py-1 font-mono text-[10px] uppercase ${
            readiness.data?.ready ? 'border-lime/20 bg-lime/10 text-lime' : 'border-danger/20 bg-danger/10 text-danger'
          }`}
        >
          {readiness.isLoading ? 'checking' : readiness.data?.ready ? 'ready' : 'gated'}
        </span>
      </header>

      <div className="grid gap-2 sm:grid-cols-2">
        {readinessChecks.slice(0, 6).map((check) => (
          <div key={check.key} className={`border px-3 py-2 text-[11px] ${statusTone(check.ok)}`}>
            <div className="font-mono uppercase">{check.label}</div>
            <div className="mt-1 text-ink/65">{check.detail}</div>
          </div>
        ))}
      </div>

      {blockingChecks.length > 0 && (
        <div className="border border-danger/20 bg-danger/5 px-3 py-2 text-xs text-danger">
          Mainnet settlement remains disabled until {blockingChecks[0]?.detail ?? 'readiness passes.'}
        </div>
      )}

      <div className="grid gap-3 text-xs sm:grid-cols-3">
        <div>
          <div className="text-ink/45">Connected wallet</div>
          <div className="mt-1 font-mono break-all">{walletBase58 ?? '—'}</div>
        </div>
        <div>
          <div className="text-ink/45">Agent operator</div>
          <div className="mt-1 font-mono break-all">{agentOperator ?? '—'}</div>
        </div>
        <div>
          <div className="text-ink/45">Proof session</div>
          <div className="mt-1 flex items-center gap-2">
            <span className="font-mono">{session ? 'signed in' : 'not signed'}</span>
            {walletBase58 && (
              <button
                type="button"
                onClick={() => (session ? signOut() : signIn())}
                className="border border-ink/15 px-2 py-1 text-[10px] hover:border-lime hover:text-lime"
              >
                {session ? 'Sign out' : 'Sign in'}
              </button>
            )}
          </div>
        </div>
      </div>

      {task.status === 'funded' && (
        <div className="flex flex-col gap-3 border-t border-ink/10 pt-4">
          <label className="flex flex-col gap-1 text-xs">
            <span className="text-ink/55">Result hash</span>
            <input
              value={resultHashText}
              onChange={(event) => setResultHashText(event.target.value)}
              placeholder="0x..."
              className="border border-ink/15 bg-paper px-3 py-2 font-mono text-xs outline-none focus:border-lime"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs">
            <span className="text-ink/55">Witness JSON</span>
            <input
              type="file"
              accept="application/json"
              onChange={(event) => void readWitnessFile(event.target.files?.[0] ?? null)}
              className="text-xs"
            />
            <textarea
              value={witnessText}
              onChange={(event) => setWitnessText(event.target.value)}
              rows={8}
              className="border border-ink/15 bg-paper px-3 py-2 font-mono text-[11px] outline-none focus:border-lime"
            />
          </label>
          <button
            type="button"
            onClick={onSubmitResult}
            disabled={!canSubmit || submitResult.isPending}
            className="w-fit border border-ink bg-ink px-4 py-2 text-xs font-medium text-paper disabled:cursor-not-allowed disabled:border-ink/15 disabled:bg-ink/10 disabled:text-ink/40"
          >
            {submitResult.isPending ? 'Submitting…' : 'Submit result'}
          </button>
        </div>
      )}

      {task.status === 'proofSubmitted' && (
        <div className="flex flex-col gap-3 border-t border-ink/10 pt-4">
          <label className="flex flex-col gap-1 text-xs">
            <span className="text-ink/55">Witness JSON</span>
            <input
              type="file"
              accept="application/json"
              onChange={(event) => void readWitnessFile(event.target.files?.[0] ?? null)}
              className="text-xs"
            />
            <textarea
              value={witnessText}
              onChange={(event) => setWitnessText(event.target.value)}
              rows={8}
              className="border border-ink/15 bg-paper px-3 py-2 font-mono text-[11px] outline-none focus:border-lime"
            />
          </label>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={onGenerateProof}
              disabled={!canGenerateProof || createProof.isPending || proofJob.isFetching}
              className="border border-ink/20 px-4 py-2 text-xs font-medium hover:border-lime hover:text-lime disabled:cursor-not-allowed disabled:text-ink/35"
            >
              {createProof.isPending || proofJob.isFetching ? 'Generating…' : 'Generate proof'}
            </button>
            <button
              type="button"
              onClick={onVerify}
              disabled={!canVerify || verifyTask.isPending}
              className="border border-ink bg-ink px-4 py-2 text-xs font-medium text-paper disabled:cursor-not-allowed disabled:border-ink/15 disabled:bg-ink/10 disabled:text-ink/40"
            >
              {verifyTask.isPending ? 'Verifying…' : 'Verify task'}
            </button>
          </div>
          <div className="font-mono text-[11px] text-ink/50">
            Proof job: {jobId ?? '—'} · status: {proofResult?.status ?? proofJob.data?.status ?? '—'}
          </div>
        </div>
      )}

      {task.status === 'verified' && (
        <div className="flex flex-col gap-3 border-t border-ink/10 pt-4">
          <div className="font-mono text-xs text-ink/60">
            Dispute window: {releaseRemaining > 0 ? `${releaseRemaining}s remaining` : 'closed'}
          </div>
          <button
            type="button"
            onClick={onRelease}
            disabled={!canRelease || releaseTask.isPending}
            className="w-fit border border-ink bg-ink px-4 py-2 text-xs font-medium text-paper disabled:cursor-not-allowed disabled:border-ink/15 disabled:bg-ink/10 disabled:text-ink/40"
          >
            {releaseTask.isPending ? 'Releasing…' : 'Release escrow'}
          </button>
        </div>
      )}

      {task.status === 'released' && (
        <div className="border-t border-ink/10 pt-4 text-xs text-lime">
          Escrow released.
        </div>
      )}

      {(submitSig || verifySig || releaseSig) && (
        <div className="grid gap-1 border-t border-ink/10 pt-3 font-mono text-[11px] text-ink/55">
          {submitSig && <div>submit: {short(submitSig)}</div>}
          {verifySig && <div>verify: {short(verifySig)}</div>}
          {releaseSig && <div>release: {short(releaseSig)}</div>}
        </div>
      )}

      {formError && (
        <div className="border border-danger/20 bg-danger/5 px-3 py-2 text-xs text-danger">
          {formError}
        </div>
      )}
    </div>
  );
}
