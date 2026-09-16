using FluentValidation;
using UniDipVeri.Application.Features.AcademicRecords.Models;

namespace UniDipVeri.Application.Features.AcademicRecords.Validators;

public class ImportAcademicRecordRequestValidator : AbstractValidator<ImportAcademicRecordRequest>
{
    public ImportAcademicRecordRequestValidator()
    {
        RuleFor(x => x.StudentNumber)
            .Cascade(CascadeMode.Stop)
            .NotEmpty().WithMessage("Student number is required.")
            .Must(sn => !string.IsNullOrWhiteSpace(sn)).WithMessage("Student number is required.");

        RuleFor(x => x.Name)
            .Cascade(CascadeMode.Stop)
            .NotEmpty().WithMessage("Student name is required.")
            .Must(name => !string.IsNullOrWhiteSpace(name)).WithMessage("Student name is required.");

        RuleFor(x => x.Email)
            .Cascade(CascadeMode.Stop)
            .NotEmpty().WithMessage("Student email is required.")
            .Must(email => !string.IsNullOrWhiteSpace(email)).WithMessage("Student email is required.")
            .EmailAddress().WithMessage("Invalid email format.");

        RuleFor(x => x.SourceRecordRef)
            .Cascade(CascadeMode.Stop)
            .NotEmpty().WithMessage("Source record reference is required.")
            .Must(sref => !string.IsNullOrWhiteSpace(sref)).WithMessage("Source record reference is required.");

        RuleFor(x => x.ProgramId)
            .NotEqual(Guid.Empty).WithMessage("Program ID cannot be empty.");

        RuleFor(x => x)
            .Must(req => req.GetEffectiveCredits() >= 0)
            .WithMessage("Credits completed cannot be negative or must be provided.");

        RuleFor(x => x.Gpa)
            .InclusiveBetween(0.0m, 4.0m).WithMessage("GPA must be between 0.0 and 4.0.");

        RuleFor(x => x.CompletedCourses)
            .NotNull().WithMessage("Completed courses cannot be null.");
    }
}
