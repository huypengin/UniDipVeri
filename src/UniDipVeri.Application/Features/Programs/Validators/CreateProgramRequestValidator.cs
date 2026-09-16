using FluentValidation;
using UniDipVeri.Application.Features.Programs.Models;
using UniDipVeri.Domain.Entities;
using UniDipVeri.Domain.Enums;

namespace UniDipVeri.Application.Features.Programs.Validators;

public class CreateProgramRequestValidator : AbstractValidator<CreateProgramRequest>
{
    public CreateProgramRequestValidator()
    {
        RuleFor(x => x.Name)
            .Cascade(CascadeMode.Stop)
            .NotEmpty().WithMessage("Program name is required.")
            .Must(name => !string.IsNullOrWhiteSpace(name)).WithMessage("Program name is required.");

        RuleFor(x => x.FullTitle)
            .Cascade(CascadeMode.Stop)
            .NotEmpty().WithMessage("Program full title is required.")
            .Must(title => !string.IsNullOrWhiteSpace(title)).WithMessage("Program full title is required.");

        RuleFor(x => x.DegreeLevel)
            .Cascade(CascadeMode.Stop)
            .NotEmpty().WithMessage("Degree level is required.")
            .Must(level => !string.IsNullOrWhiteSpace(level)).WithMessage("Degree level is required.")
            .Must(level => Enum.TryParse<DegreeLevel>(level.Trim(), ignoreCase: true, out var parsedLevel) && Enum.IsDefined(parsedLevel))
            .WithMessage(level => $"Invalid degree level '{level}'. Valid levels are: {string.Join(", ", Enum.GetNames<DegreeLevel>())}.");

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
    }
}
