using FluentValidation;
using UniDipVeri.Application.Features.Auth.Models;

namespace UniDipVeri.Application.Features.Auth.Validators;

public class ChangePasswordRequestValidator : AbstractValidator<ChangePasswordRequest>
{
    public ChangePasswordRequestValidator()
    {
        RuleFor(x => x.CurrentPassword)
            .Cascade(CascadeMode.Stop)
            .NotEmpty().WithMessage("Current password is required.")
            .Must(pwd => !string.IsNullOrWhiteSpace(pwd)).WithMessage("Current password is required.");

        RuleFor(x => x.NewPassword)
            .Cascade(CascadeMode.Stop)
            .NotEmpty().WithMessage("Password must be at least 8 characters long.")
            .MinimumLength(8).WithMessage("Password must be at least 8 characters long.")
            .Must(pwd => pwd.Any(char.IsLetter) && pwd.Any(c => char.IsDigit(c) || !char.IsLetterOrDigit(c)))
            .WithMessage("Password must contain at least one letter and at least one number or special character.");
    }
}
