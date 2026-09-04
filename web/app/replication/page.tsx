import { ReplicationLab } from "@/components/replication-lab";

export default function ReplicationPage() {
  return (
    <main className="replication-page">
      <ReplicationLab />
      <section className="concepts replication-next">
        <div>
          <p className="eyebrow">next implementation horizon</p>
          <h2>From consistency to recovery.</h2>
        </div>
        <p>
          The next slice adds health checks, failover delay, retries and retry amplification, circuit breakers,
          exponential backoff, and correlated failure domains. Leader election comes only after those failure and
          recovery mechanics are explicit, so consensus is taught as a response to concrete coordination problems
          rather than as an isolated algorithm.
        </p>
      </section>
    </main>
  );
}
