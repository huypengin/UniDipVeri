namespace UniDipVeri.Application.Configurations;

public class ApprovalPolicyOptions
{
    public const string SectionName = "ApprovalPolicy";

    public bool AllowRegistrarApproverCombination { get; init; } = false;
}

