import { Link, useNavigate, useSearchParams } from 'react-router'
import { useForm, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Loader2Icon } from 'lucide-react'
import { FormField } from '@/components/common/form-field'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useLoginMutation } from '@/features/auth/api'
import { AuthLayout } from '@/features/auth/components/auth-layout'
import { loginSchema, type LoginValues } from '@/features/auth/schemas'
import { ApiError } from '@/lib/api/client'
import { handleFormError } from '@/lib/forms'

/** Only same-app relative paths are accepted as post-login targets (no open redirects). */
function safeRedirect(target: string | null): string {
  return target && target.startsWith('/') && !target.startsWith('//') ? target : '/'
}

export function LoginPage() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const login = useLoginMutation()
  const form = useForm<LoginValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '', remember: false },
  })
  const { errors } = form.formState
  const watchedRemember = useWatch({ control: form.control, name: 'remember' })

  const onSubmit = form.handleSubmit((values) =>
    login.mutate(values, {
      onSuccess: () => navigate(safeRedirect(params.get('redirect')), { replace: true }),
      onError: (error) => {
        if (error instanceof ApiError && error.status === 422 && error.code !== 'VALIDATION_FAILED') {
          form.setError('root', { message: error.message })
          return
        }
        handleFormError(error, form.setError, ['email', 'password'])
      },
    }),
  )

  return (
    <AuthLayout
      title="Sign in"
      description="Use your work e-mail and password."
      footer={
        <span>
          New business? <Link to="/register" className="font-medium text-primary underline-offset-4 hover:underline">Create an account</Link>
        </span>
      }
    >
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
        {errors.root?.message && (
          <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
            {errors.root.message}
          </p>
        )}
        <FormField label="E-mail" error={errors.email?.message}>
          <Input type="email" autoComplete="username" autoFocus {...form.register('email')} />
        </FormField>
        <FormField label="Password" error={errors.password?.message}>
          <Input type="password" autoComplete="current-password" {...form.register('password')} />
        </FormField>
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Checkbox
              id="remember"
              checked={watchedRemember}
              onCheckedChange={(checked) => form.setValue('remember', checked === true)}
            />
            <Label htmlFor="remember" className="font-normal">Keep me signed in</Label>
          </div>
          <Link to="/forgot-password" className="text-sm text-primary underline-offset-4 hover:underline">
            Forgot password?
          </Link>
        </div>
        <Button type="submit" disabled={login.isPending}>
          {login.isPending && <Loader2Icon data-icon="inline-start" className="animate-spin" />}
          Sign in
        </Button>
      </form>
    </AuthLayout>
  )
}
