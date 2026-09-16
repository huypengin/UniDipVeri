using FluentValidation;
using UniDipVeri.Application.Features.Auth.Models;

namespace UniDipVeri.Application.Features.Auth.Validators;

public class ResetPasswordRequestValidator : AbstractValidator<ResetPasswordRequest>
{
    public ResetPasswordRequestValidator()
    {
        RuleFor(x => x.Email)
            .Cascade(CascadeMode.Stop)
            .NotEmpty().WithMessage("Email is required.")
            .Must(email => !string.IsNullOrWhiteSpace(email)).WithMessage("Email is required.")
            .EmailAddress().WithMessage("Invalid email format.");
    }
}
