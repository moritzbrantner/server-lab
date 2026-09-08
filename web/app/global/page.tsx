import { GameplayLatencyLab } from "@/components/gameplay-latency-lab";
import { GlobalIngressLab } from "@/components/global-ingress-lab";
import { RoomAuthorityLab } from "@/components/room-authority-lab";

export default function GlobalPage() {
  return (
    <>
      <GlobalIngressLab />
      <RoomAuthorityLab />
      <GameplayLatencyLab />
    </>
  );
}
