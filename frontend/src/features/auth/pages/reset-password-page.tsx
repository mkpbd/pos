import { Link, useNavigate, useSearchParams } from 'react-router'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Loader2Icon } from 'lucide-react'
import { toast } from 'sonner'
import { FormField } from '@/components/common/form-field'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useResetPasswordMutation } from '@/features/auth/api'
import { AuthLayout } from '@/features/auth/components/auth-layout'
import { resetPasswordSchema, type ResetPasswordValues } from '@/features/auth/schemas'
import { ApiError } from '@/lib/api/client'
import { handleFormError } from '@/lib/forms'

export function ResetPasswordPage() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const token = params.get('token') ?? ''
  const email = params.get('email') ?? ''
  const reset = useResetPasswordMutation()
  const form = useForm<ResetPasswordValues>({
    resolver: zodResolver(resetPasswordSchema),
    defaultValues: { password: '', password_confirmation: '' },
  })
  const { errors } = form.formState

  const onSubmit = form.handleSubmit((values) =>
    reset.mutate(
      { ...values, token, email },
      {
        onSuccess: (data) => {
          toast.success(data.message)
          navigate('/login', { replace: true })
        },
        onError: (error) => {
          if (error instanceof ApiError && error.code === 'INVALID_RESET_TOKEN') {
            form.setError('root', { message: error.message })
            return
          }
          handleFormError(error, form.setError, ['password', 'password_confirmation'])
        },
      },
    ),
  )

  const footer = <Link to="/forgot-password" className="text-primary underline-offset-4 hover:underline">Request a new link</Link>

  if (!token || !email) {
    return (
      <AuthLayout title="Invalid reset link" description="This link is incomplete. Request a new one." footer={footer}>
        <p className="text-sm text-muted-foreground">Open the link from your most recent reset e-mail.</p>
      </AuthLayout>
    )
  }

  return (
    <AuthLayout title="Choose a new password" description={email} footer={footer}>
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
        {errors.root?.message && (
          <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
            {errors.root.message}
          </p>
        )}
        <FormField label="New password" error={errors.password?.message}>
          <Input type="password" autoComplete="new-password" autoFocus {...form.register('password')} />
        </FormField>
        <FormField label="Confirm new password" error={errors.password_confirmation?.message}>
          <Input type="password" autoComplete="new-password" {...form.register('password_confirmation')} />
        </FormField>
        <Button type="submit" disabled={reset.isPending}>
          {reset.isPending && <Loader2Icon data-icon="inline-start" className="animate-spin" />}
          Reset password
        </Button>
      </form>
    </AuthLayout>
  )
}
