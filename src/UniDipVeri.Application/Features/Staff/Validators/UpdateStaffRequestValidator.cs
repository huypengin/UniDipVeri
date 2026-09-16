using FluentValidation;
using UniDipVeri.Application.Features.Staff.Models;
using UniDipVeri.Domain.Enums;

namespace UniDipVeri.Application.Features.Staff.Validators;

public class UpdateStaffRequestValidator : AbstractValidator<UpdateStaffRequest>
{
    public UpdateStaffRequestValidator()
    {
        When(x => x.Name is not null, () =>
        {
            RuleFor(x => x.Name)
                .NotEmpty().WithMessage("Name cannot be empty.")
                .Must(name => !string.IsNullOrWhiteSpace(name)).WithMessage("Name cannot be empty.");
        });

        When(x => x.Email is not null, () =>
        {
            RuleFor(x => x.Email)
                .Cascade(CascadeMode.Stop)
                .NotEmpty().WithMessage("Email cannot be empty.")
                .Must(email => !string.IsNullOrWhiteSpace(email)).WithMessage("Email cannot be empty.")
                .EmailAddress().WithMessage("Invalid email format.");
        });

        When(x => x.Roles is not null, () =>
        {
            RuleFor(x => x.Roles)
                .Must(roles => roles is not null && roles.Count > 0)
                .WithMessage("At least one staff role must be assigned.");

            RuleForEach(x => x.Roles)
                .Cascade(CascadeMode.Stop)
                .NotEmpty().WithMessage("Role name cannot be empty.")
                .Must(role => !string.IsNullOrWhiteSpace(role)).WithMessage("Role name cannot be empty.")
                .Must(role => Enum.TryParse<StaffRole>(role.Trim(), ignoreCase: true, out var parsedRole) && Enum.IsDefined(parsedRole))
                .WithMessage(role => $"Invalid role: '{role}'. Valid roles are: {string.Join(", ", Enum.GetNames<StaffRole>())}.");
        });
    }
}
