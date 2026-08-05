/**
 * Accessible UI primitives, in the shadcn/ui idiom: unstyled semantics, variants through
 * class-variance-authority, and `cn()` for override-friendly class merging.
 */

import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

// --- Button ------------------------------------------------------------------

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/90",
        secondary: "bg-muted text-foreground hover:bg-muted/70",
        outline: "border border-border bg-transparent hover:bg-muted",
        destructive: "bg-destructive text-destructive-foreground hover:bg-destructive/90",
        ghost: "hover:bg-muted",
      },
      size: {
        default: "h-10 px-4 py-2",
        sm: "h-8 rounded-md px-3 text-xs",
        lg: "h-11 rounded-md px-6",
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
      className={cn("rounded-lg border border-border bg-card text-card-foreground", className)}
      {...props}
    />
  ),
);
Card.displayName = "Card";

export const CardHeader = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("flex flex-col space-y-1.5 p-6", className)} {...props} />
);

export const CardTitle = ({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) => (
  <h3 className={cn("text-lg font-semibold leading-none tracking-tight", className)} {...props} />
);

export const CardDescription = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLParagraphElement>) => (
  <p className={cn("text-sm text-muted-foreground", className)} {...props} />
);

export const CardContent = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("p-6 pt-0", className)} {...props} />
);

export const CardFooter = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("flex items-center p-6 pt-0", className)} {...props} />
);

// --- Input / Label -----------------------------------------------------------

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
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
    className={cn("text-sm font-medium leading-none text-foreground", className)}
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
  "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium",
  {
    variants: {
      variant: {
        default: "border-transparent bg-primary/10 text-primary",
        neutral: "border-border bg-muted text-muted-foreground",
        success: "border-transparent bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
        warning: "border-transparent bg-amber-500/15 text-amber-700 dark:text-amber-400",
        danger: "border-transparent bg-destructive/15 text-destructive",
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
      "rounded-lg border p-4 text-sm",
      tone === "info" && "border-border bg-muted/50 text-foreground",
      tone === "warning" && "border-amber-500/40 bg-amber-500/10 text-amber-800 dark:text-amber-300",
      tone === "danger" && "border-destructive/40 bg-destructive/10 text-destructive",
      className,
    )}
  >
    {title ? <p className="mb-1 font-semibold">{title}</p> : null}
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
