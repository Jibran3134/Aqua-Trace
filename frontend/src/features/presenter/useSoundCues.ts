import { useEffect } from "react";
import { useStore } from "../../state/store";
import { cues } from "../../ui/sound";

/** Plays a cue on each story beat, only when sound is on. Subscribes outside React's render. */
export function useSoundCues() {
  useEffect(
    () =>
      useStore.subscribe((s, prev) => {
        if (!s.sound) return;
        if (s.detection && !prev.detection) cues.ping();
        if (s.agent.cleared.length > prev.agent.cleared.length) cues.thud();
        if (s.agent.foundAt && !prev.agent.foundAt) cues.found();
        if (s.reveal && !prev.reveal) cues.reveal();
      }),
    [],
  );
}
