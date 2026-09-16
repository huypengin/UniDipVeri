using FluentValidation;
using UniDipVeri.Application.Features.Auth.Models;

namespace UniDipVeri.Application.Features.Auth.Validators;

public class LoginRequestValidator : AbstractValidator<LoginRequest>
{
    public LoginRequestValidator()
    {
        RuleFor(x => x.Email)
            .Cascade(CascadeMode.Stop)
            .NotEmpty().WithMessage("Invalid email or password.")
            .Must(email => !string.IsNullOrWhiteSpace(email)).WithMessage("Invalid email or password.");

        RuleFor(x => x.Password)
            .Cascade(CascadeMode.Stop)
            .NotEmpty().WithMessage("Invalid email or password.")
            .Must(pwd => !string.IsNullOrWhiteSpace(pwd)).WithMessage("Invalid email or password.");
    }
}
