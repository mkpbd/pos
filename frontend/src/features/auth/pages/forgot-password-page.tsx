import { Link } from 'react-router'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Loader2Icon, MailCheckIcon } from 'lucide-react'
import { FormField } from '@/components/common/form-field'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useForgotPasswordMutation } from '@/features/auth/api'
import { AuthLayout } from '@/features/auth/components/auth-layout'
import { forgotPasswordSchema, type ForgotPasswordValues } from '@/features/auth/schemas'
import { handleFormError } from '@/lib/forms'

export function ForgotPasswordPage() {
  const forgot = useForgotPasswordMutation()
  const form = useForm<ForgotPasswordValues>({ resolver: zodResolver(forgotPasswordSchema), defaultValues: { email: '' } })

  const onSubmit = form.handleSubmit((values) =>
    forgot.mutate(values, { onError: (error) => handleFormError(error, form.setError, ['email']) }),
  )

  return (
    <AuthLayout
      title="Reset your password"
      description="We will e-mail you a link to choose a new password."
      footer={<Link to="/login" className="text-primary underline-offset-4 hover:underline">Back to sign in</Link>}
    >
      {forgot.isSuccess ? (
        <div role="status" className="flex flex-col items-center gap-3 text-center">
          <MailCheckIcon className="size-8 text-primary" aria-hidden />
          <p className="text-sm">{forgot.data.message}</p>
        </div>
      ) : (
        <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
          <FormField label="E-mail" error={form.formState.errors.email?.message}>
            <Input type="email" autoComplete="email" autoFocus {...form.register('email')} />
          </FormField>
          <Button type="submit" disabled={forgot.isPending}>
            {forgot.isPending && <Loader2Icon data-icon="inline-start" className="animate-spin" />}
            Send reset link
          </Button>
        </form>
      )}
    </AuthLayout>
  )
}
