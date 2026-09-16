using FluentValidation;
using UniDipVeri.Application.Features.Staff.Models;
using UniDipVeri.Domain.Enums;

namespace UniDipVeri.Application.Features.Staff.Validators;

public class CreateStaffRequestValidator : AbstractValidator<CreateStaffRequest>
{
    public CreateStaffRequestValidator()
    {
        RuleFor(x => x.Name)
            .Cascade(CascadeMode.Stop)
            .NotEmpty().WithMessage("Name is required.")
            .Must(name => !string.IsNullOrWhiteSpace(name)).WithMessage("Name is required.");

        RuleFor(x => x.Email)
            .Cascade(CascadeMode.Stop)
            .NotEmpty().WithMessage("Email is required.")
            .Must(email => !string.IsNullOrWhiteSpace(email)).WithMessage("Email is required.")
            .EmailAddress().WithMessage("Invalid email format.");

        RuleFor(x => x.Password)
            .Cascade(CascadeMode.Stop)
            .NotEmpty().WithMessage("Password is required.")
            .Must(pwd => !string.IsNullOrWhiteSpace(pwd)).WithMessage("Password is required.");

        RuleFor(x => x.Roles)
            .Cascade(CascadeMode.Stop)
            .NotNull().WithMessage("At least one staff role must be assigned.")
            .Must(roles => roles is not null && roles.Count > 0).WithMessage("At least one staff role must be assigned.");

        RuleForEach(x => x.Roles)
            .Cascade(CascadeMode.Stop)
            .NotEmpty().WithMessage("Role name cannot be empty.")
            .Must(role => !string.IsNullOrWhiteSpace(role)).WithMessage("Role name cannot be empty.")
            .Must(role => Enum.TryParse<StaffRole>(role.Trim(), ignoreCase: true, out var parsedRole) && Enum.IsDefined(parsedRole))
            .WithMessage(role => $"Invalid role: '{role}'. Valid roles are: {string.Join(", ", Enum.GetNames<StaffRole>())}.");
    }
}
