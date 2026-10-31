import { Link, useNavigate } from 'react-router'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Loader2Icon } from 'lucide-react'
import { toast } from 'sonner'
import { FormField } from '@/components/common/form-field'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useRegisterMutation } from '@/features/auth/api'
import { AuthLayout } from '@/features/auth/components/auth-layout'
import { registerSchema, type RegisterValues } from '@/features/auth/schemas'
import { handleFormError } from '@/lib/forms'

const FIELDS = ['organization_name', 'branch_name', 'name', 'email', 'password', 'password_confirmation'] as const

export function RegisterPage() {
  const navigate = useNavigate()
  const register = useRegisterMutation()
  const form = useForm<RegisterValues>({
    resolver: zodResolver(registerSchema),
    defaultValues: { organization_name: '', branch_name: '', name: '', email: '', password: '', password_confirmation: '' },
  })
  const { errors } = form.formState

  const onSubmit = form.handleSubmit(({ branch_name, ...values }) =>
    register.mutate(
      { ...values, ...(branch_name ? { branch_name } : {}) },
      {
        onSuccess: (me) => {
          toast.success(`Welcome, ${me.user.name}! ${me.organization?.name} is ready.`)
          navigate('/', { replace: true })
        },
        onError: (error) => handleFormError(error, form.setError, FIELDS),
      },
    ),
  )

  return (
    <AuthLayout
      title="Create your business account"
      description="Sets up your organization, a main branch and your administrator login."
      footer={
        <span>
          Already registered? <Link to="/login" className="font-medium text-primary underline-offset-4 hover:underline">Sign in</Link>
        </span>
      }
    >
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
        <FormField label="Business name" error={errors.organization_name?.message}>
          <Input autoComplete="organization" autoFocus {...form.register('organization_name')} />
        </FormField>
        <FormField label="First branch name" error={errors.branch_name?.message} hint="Optional — defaults to “Main Branch”.">
          <Input {...form.register('branch_name')} />
        </FormField>
        <FormField label="Your name" error={errors.name?.message}>
          <Input autoComplete="name" {...form.register('name')} />
        </FormField>
        <FormField label="E-mail" error={errors.email?.message}>
          <Input type="email" autoComplete="email" {...form.register('email')} />
        </FormField>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label="Password" error={errors.password?.message}>
            <Input type="password" autoComplete="new-password" {...form.register('password')} />
          </FormField>
          <FormField label="Confirm password" error={errors.password_confirmation?.message}>
            <Input type="password" autoComplete="new-password" {...form.register('password_confirmation')} />
          </FormField>
        </div>
        <Button type="submit" disabled={register.isPending}>
          {register.isPending && <Loader2Icon data-icon="inline-start" className="animate-spin" />}
          Create account
        </Button>
      </form>
    </AuthLayout>
  )
}
