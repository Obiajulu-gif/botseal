/**
 * Accessible UI primitives, in the shadcn/ui idiom: unstyled semantics, variants through
 * class-variance-authority, and `cn()` for override-friendly class merging.
 */

import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

// --- Button ------------------------------------------------------------------

export const buttonVariants = cva(
  "group relative isolate inline-flex items-center justify-center gap-2 overflow-hidden whitespace-nowrap rounded-xl text-sm font-semibold tracking-[-0.01em] transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-45",
  {
    variants: {
      variant: {
        default:
          "bg-gradient-to-br from-primary via-[#ff5c39] to-[#ff7a45] text-primary-foreground shadow-[0_12px_35px_hsl(var(--primary)/0.22)] before:absolute before:inset-y-0 before:left-[-60%] before:w-1/2 before:skew-x-[-20deg] before:bg-white/20 before:opacity-0 before:transition-all before:duration-500 hover:-translate-y-0.5 hover:shadow-[0_16px_42px_hsl(var(--primary)/0.34)] hover:before:left-[130%] hover:before:opacity-100",
        secondary:
          "border border-accent/20 bg-accent/10 text-accent hover:-translate-y-0.5 hover:border-accent/40 hover:bg-accent/15",
        outline:
          "border border-white/10 bg-white/[0.035] text-foreground shadow-[inset_0_1px_0_hsl(0_0%_100%/0.04)] hover:-translate-y-0.5 hover:border-primary/35 hover:bg-white/[0.07]",
        destructive:
          "bg-destructive text-destructive-foreground shadow-[0_10px_30px_hsl(var(--destructive)/0.18)] hover:-translate-y-0.5 hover:bg-destructive/90",
        ghost: "text-foreground/70 hover:bg-white/[0.06] hover:text-foreground",
      },
      size: {
        default: "h-11 px-4 py-2",
        sm: "h-9 rounded-lg px-3 text-xs",
        lg: "h-12 rounded-xl px-6",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, type = "button", ...props }, ref) => (
    <button
      ref={ref}
      type={type}
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  ),
);
Button.displayName = "Button";

// --- Card --------------------------------------------------------------------

export const Card = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        "glass-panel rounded-2xl border border-white/[0.08] text-card-foreground",
        className,
      )}
      {...props}
    />
  ),
);
Card.displayName = "Card";

export const CardHeader = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("relative z-[1] flex flex-col space-y-1.5 p-6", className)} {...props} />
);

export const CardTitle = ({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) => (
  <h3
    className={cn("font-display text-lg font-semibold leading-none tracking-[-0.025em]", className)}
    {...props}
  />
);

export const CardDescription = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLParagraphElement>) => (
  <p className={cn("text-sm leading-relaxed text-foreground/60", className)} {...props} />
);

export const CardContent = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("relative z-[1] p-6 pt-0", className)} {...props} />
);

export const CardFooter = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("relative z-[1] flex items-center p-6 pt-0", className)} {...props} />
);

// --- Input / Label -----------------------------------------------------------

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        "flex h-11 w-full rounded-xl border border-white/[0.09] bg-black/20 px-3.5 py-2 text-sm text-foreground shadow-[inset_0_1px_0_hsl(0_0%_100%/0.025)] ring-offset-background transition-colors placeholder:text-foreground/30 focus-visible:border-primary/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    />
  ),
);
Input.displayName = "Input";

export const Label = React.forwardRef<
  HTMLLabelElement,
  React.LabelHTMLAttributes<HTMLLabelElement>
>(({ className, ...props }, ref) => (
  <label
    ref={ref}
    className={cn("text-sm font-medium leading-none text-foreground/[0.87]", className)}
    {...props}
  />
));
Label.displayName = "Label";

/** Field-level error text, wired to its input with `aria-describedby` by the caller. */
export const FieldError = ({ children, id }: { children?: React.ReactNode; id?: string }) =>
  children ? (
    <p id={id} role="alert" className="text-xs text-destructive">
      {children}
    </p>
  ) : null;

// --- Badge -------------------------------------------------------------------

const badgeVariants = cva(
  "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[0.68rem] font-semibold uppercase tracking-[0.08em] backdrop-blur-sm",
  {
    variants: {
      variant: {
        default: "border-primary/20 bg-primary/10 text-[#ff8a67]",
        neutral: "border-white/[0.08] bg-white/[0.045] text-foreground/60",
        success: "border-emerald-400/20 bg-emerald-400/10 text-emerald-300",
        warning: "border-amber-400/20 bg-amber-400/10 text-amber-300",
        danger: "border-destructive/25 bg-destructive/10 text-red-300",
      },
    },
    defaultVariants: { variant: "neutral" },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export const Badge = ({ className, variant, ...props }: BadgeProps) => (
  <span className={cn(badgeVariants({ variant }), className)} {...props} />
);

// --- Alert -------------------------------------------------------------------

export const Alert = ({
  tone = "info",
  title,
  children,
  className,
}: {
  tone?: "info" | "warning" | "danger";
  title?: string;
  children?: React.ReactNode;
  className?: string;
}) => (
  <div
    role="status"
    className={cn(
      "glass-panel rounded-2xl border p-4 text-sm leading-relaxed",
      tone === "info" && "border-accent/20 bg-accent/[0.055] text-foreground/[0.87]",
      tone === "warning" && "border-amber-400/25 bg-amber-400/[0.07] text-amber-200",
      tone === "danger" && "border-destructive/30 bg-destructive/[0.08] text-red-200",
      className,
    )}
  >
    {title ? <p className="mb-1 font-display font-semibold tracking-[-0.015em]">{title}</p> : null}
    {children}
  </div>
);

// --- Spinner -----------------------------------------------------------------

export const Spinner = ({ className }: { className?: string }) => (
  <span
    aria-hidden="true"
    className={cn(
      "inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent",
      className,
    )}
  />
);
