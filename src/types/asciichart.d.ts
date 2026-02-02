declare module "asciichart" {
  export interface PlotConfig {
    height?: number;
    offset?: number;
    min?: number;
    max?: number;
    format?: (x: number) => string;
    colors?: number[];
    symbols?: string[];
  }

  export function plot(series: number[] | number[][], config?: PlotConfig): string;
}
