using FluentValidation;
using UniDipVeri.Application.Features.Programs.Models;
using UniDipVeri.Domain.Entities;
using UniDipVeri.Domain.Enums;

namespace UniDipVeri.Application.Features.Programs.Validators;

public class UpdateProgramRequestValidator : AbstractValidator<UpdateProgramRequest>
{
    public UpdateProgramRequestValidator()
    {
        When(x => x.Name is not null, () =>
        {
            RuleFor(x => x.Name)
                .NotEmpty().WithMessage("Program name cannot be empty.")
                .Must(name => !string.IsNullOrWhiteSpace(name)).WithMessage("Program name cannot be empty.");
        });

        When(x => x.FullTitle is not null, () =>
        {
            RuleFor(x => x.FullTitle)
                .NotEmpty().WithMessage("Program full title cannot be empty.")
                .Must(title => !string.IsNullOrWhiteSpace(title)).WithMessage("Program full title cannot be empty.");
        });

        When(x => x.DegreeLevel is not null, () =>
        {
            RuleFor(x => x.DegreeLevel)
                .Cascade(CascadeMode.Stop)
                .NotEmpty().WithMessage("Degree level cannot be empty.")
                .Must(level => !string.IsNullOrWhiteSpace(level)).WithMessage("Degree level cannot be empty.")
                .Must(level => level is not null && Enum.TryParse<DegreeLevel>(level.Trim(), ignoreCase: true, out var parsedLevel) && Enum.IsDefined(parsedLevel))
                .WithMessage(level => $"Invalid degree level '{level}'. Valid levels are: {string.Join(", ", Enum.GetNames<DegreeLevel>())}.");
        });

        When(x => x.Status is not null, () =>
        {
            RuleFor(x => x.Status)
                .Cascade(CascadeMode.Stop)
                .NotEmpty().WithMessage("Status cannot be empty.")
                .Must(status => !string.IsNullOrWhiteSpace(status)).WithMessage("Status cannot be empty.")
                .Must(status => status is not null && Enum.TryParse<ProgramStatus>(status.Trim(), ignoreCase: true, out var parsedStatus) && Enum.IsDefined(parsedStatus))
                .WithMessage(status => $"Invalid status '{status}'. Valid statuses are: {string.Join(", ", Enum.GetNames<ProgramStatus>())}.");
        });

        // When both FullTitle and DegreeLevel are provided in the update request, validate keyword matching
        When(x => x.FullTitle is not null && x.DegreeLevel is not null, () =>
        {
            RuleFor(x => x)
                .Must(req =>
                {
                    if (string.IsNullOrWhiteSpace(req.FullTitle) || string.IsNullOrWhiteSpace(req.DegreeLevel))
                    {
                        return true;
                    }

                    if (!Enum.TryParse<DegreeLevel>(req.DegreeLevel.Trim(), ignoreCase: true, out var degreeLevel) || !Enum.IsDefined(degreeLevel))
                    {
                        return true;
                    }

                    try
                    {
                        Program.ValidateDegreeLevelKeyword(req.FullTitle.Trim(), degreeLevel);
                        return true;
                    }
                    catch (ArgumentException)
                    {
                        return false;
                    }
                })
                .WithMessage(req =>
                {
                    Enum.TryParse<DegreeLevel>(req.DegreeLevel?.Trim(), ignoreCase: true, out var degreeLevel);
                    return $"The degree name '{req.FullTitle}' is invalid or does not match the degree level '{degreeLevel}'.";
                });
        });
    }
}
