import { AlertOctagon, RotateCcw } from "lucide-react";
import { Component, type ErrorInfo, type ReactNode } from "react";
import { Button } from "./primitives";

interface Props {
  /** Shown in the fallback, e.g. "map" or "panel". */
  area: string;
  children: ReactNode;
}

/** Contains a render crash to one region so the demo keeps running; "Recover" remounts it. */
export class ErrorBoundary extends Component<Props, { error: Error | null; key: number }> {
  state = { error: null as Error | null, key: 0 };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`[AquaTrace] ${this.props.area} crashed`, error, info.componentStack);
  }

  render() {
    if (!this.state.error) return <div key={this.state.key} className="contents">{this.props.children}</div>;
    return (
      <div className="grid h-full place-items-center rounded-2xl border border-vermilion/40 bg-vermilion/[0.05] p-6 text-center">
        <div>
          <AlertOctagon className="mx-auto size-7 text-vermilion" />
          <div className="mt-2 font-display text-lg font-bold">The {this.props.area} hit a snag</div>
          <p className="mt-1 max-w-sm text-[0.85rem] text-silt">{this.state.error.message}</p>
          <Button tone="ghost" className="mt-4" icon={<RotateCcw className="size-4" />} onClick={() => this.setState((s) => ({ error: null, key: s.key + 1 }))}>
            Recover
          </Button>
        </div>
      </div>
    );
  }
}
